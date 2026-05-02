/**
 * DEUK Worker — Agent that executes tasks in a sandboxed container
 * Connects to: gateway (LLM calls), MCP servers (tools via stdio), orchestrator (reporting)
 * Uses centralized @deuk/config for all configuration.
 */
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  DEFAULTS,
  parseConfig,
  MODEL_COSTS,
  TIER_DEFAULT_MODEL,
} from '@deuk/config';

const cfg = parseConfig(process.env);

// ─── Task Config ───
const TASK_ID = process.env.TASK_ID || 'unknown';
const REPO = process.env.TASK_REPO || '';
const GOAL = process.env.TASK_GOAL || '';
const TIER = process.env.TASK_TIER || 'worker';
const PROFILE = process.env.TASK_PROFILE || 'default';
const BUDGET_USD = parseFloat(process.env.TASK_BUDGET_USD || String(DEFAULTS.TASK_BUDGET_USD));
const MODEL = process.env.TASK_MODEL || TIER_DEFAULT_MODEL[TIER] || TIER_DEFAULT_MODEL['worker'];
const GATEWAY_URL = cfg.GATEWAY_URL;
const ORCHESTRATOR_URL = cfg.ORCHESTRATOR_URL;
const WORKSPACE = DEFAULTS.WORKSPACE;

// ─── State ───
let spentUsd = 0;
let spentTokens = 0;
const checkpointPath = join(WORKSPACE, '.deuk-checkpoint.json');

function log(event, data = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    svc: 'worker',
    task_id: TASK_ID,
    tier: TIER,
    event,
    ...data,
  }));
}

function saveCheckpoint(step, data = {}) {
  writeFileSync(checkpointPath, JSON.stringify({ step, ...data, ts: Date.now() }));
}

// ─── MCP Client ───
class MCPClient {
  constructor(name, command, args = []) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.proc = null;
    this.reqId = 0;
    this.pending = new Map();
    this.tools = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let buffer = '';
      this.proc.stdout.on('data', (data) => {
        buffer += data.toString();
        while (true) {
          const match = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
          if (!match) break;
          const len = parseInt(match[1], 10);
          const headerLen = match[0].length;
          if (buffer.length < headerLen + len) break;
          const json = buffer.slice(headerLen, headerLen + len);
          buffer = buffer.slice(headerLen + len);
          try {
            const msg = JSON.parse(json);
            this.handleMessage(msg);
          } catch (e) {
            log('mcp.parse_error', { name: this.name, error: e.message });
          }
        }
      });

      this.proc.stderr.on('data', (data) => {
        log('mcp.stderr', { name: this.name, data: data.toString().trim() });
      });

      this.proc.on('error', (err) => {
        log('mcp.error', { name: this.name, error: err.message });
        reject(err);
      });

      // Send initialize
      this.sendRequest('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'deuk-worker', version: '0.2.0' } })
        .then(() => this.sendRequest('tools/list', {}))
        .then((res) => {
          this.tools = res.tools || [];
          log('mcp.ready', { name: this.name, tools: this.tools.map(t => t.name) });
          resolve();
        })
        .catch(reject);
    });
  }

  sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const payload = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
      this.proc.stdin.write(payload);
    });
  }

  handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  async callTool(name, args) {
    return this.sendRequest('tools/call', { name, arguments: args });
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

// ─── LLM Call via Gateway ───
async function callLLM(messages, model) {
  const estimatedCost = estimateCost(messages, model);
  if (spentUsd + estimatedCost > BUDGET_USD) {
    throw new Error(`Budget exceeded: ${spentUsd.toFixed(2)} + ${estimatedCost.toFixed(2)} > ${BUDGET_USD}`);
  }

  log('llm.call', { model, estimated_cost: estimatedCost });

  const res = await fetch(`${GATEWAY_URL}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': TASK_ID,
      'X-Tier': TIER,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    log('llm.error', { status: res.status, error: err });
    throw new Error(`Gateway error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  const cost = calculateCost(usage.prompt_tokens || 0, usage.completion_tokens || 0, model);
  spentUsd += cost;
  spentTokens += (usage.total_tokens || 0);

  log('llm.response', {
    model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    cost_usd: cost,
    spent_usd: spentUsd,
  });

  await reportSpend();

  return data.choices?.[0]?.message?.content || '';
}

function estimateCost(messages, model) {
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const estimatedTokens = totalChars / 4;
  const rate = MODEL_COSTS[model]?.in || 0.003;
  return (estimatedTokens / 1000) * rate;
}

function calculateCost(promptTokens, completionTokens, model) {
  const rate = MODEL_COSTS[model] || { in: 0.003, out: 0.015 };
  return (promptTokens / 1000) * rate.in + (completionTokens / 1000) * rate.out;
}

async function reportSpend() {
  try {
    await fetch(`${ORCHESTRATOR_URL}/tasks/${TASK_ID}/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spent_usd: spentUsd, spent_tokens: spentTokens }),
    });
  } catch (e) { /* ignore */ }
}

// ─── Main Worker Loop ───
async function main() {
  log('worker.started', { repo: REPO, goal: GOAL, tier: TIER, profile: PROFILE, budget: BUDGET_USD, model: MODEL });

  if (!existsSync(WORKSPACE)) {
    mkdirSync(WORKSPACE, { recursive: true });
  }

  // Start MCP clients
  const mcpFs = new MCPClient('fs', 'node', ['/app/node_modules/@deuk/mcp-fs/src/index.js']);
  const mcpGit = new MCPClient('git', 'node', ['/app/node_modules/@deuk/mcp-git/src/index.js']);

  try {
    await mcpFs.start();
    await mcpGit.start();
  } catch (err) {
    log('mcp.start_failed', { error: err.message });
    // Continue with fallback local tools
  }

  let step = 0;
  if (existsSync(checkpointPath)) {
    try {
      const cp = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      step = cp.step || 0;
      log('worker.resume', { from_step: step });
    } catch { /* ignore */ }
  }

  // Step 1: Clone repo
  if (step < 1 && REPO) {
    log('worker.clone', { repo: REPO });
    try {
      if (mcpGit.tools.find(t => t.name === 'git_clone')) {
        await mcpGit.callTool('git_clone', { url: `https://github.com/${REPO}.git` });
      } else {
        const { execSync } = await import('child_process');
        execSync(`git clone --depth 50 "https://github.com/${REPO}.git" .`, { cwd: WORKSPACE, timeout: 60000 });
      }
      saveCheckpoint(1, { cloned: REPO });
    } catch (err) {
      log('worker.clone_failed', { error: err.message });
    }
  }

  // Step 2: Explore repo structure
  if (step < 2) {
    log('worker.explore');
    try {
      let files;
      if (mcpFs.tools.find(t => t.name === 'list_dir')) {
        const res = await mcpFs.callTool('list_dir', { path: '.' });
        files = res.entries?.length || 0;
      } else {
        const { readdirSync } = await import('fs');
        files = readdirSync(WORKSPACE).length;
      }
      saveCheckpoint(2, { files });
    } catch (err) {
      log('worker.explore_failed', { error: err.message });
    }
  }

  // Step 3: Call LLM with task
  if (step < 3) {
    log('worker.plan');
    try {
      const prompt = `You are a ${TIER} agent working on task ${TASK_ID}.
Goal: ${GOAL}
Profile: ${PROFILE}
Budget: $${BUDGET_USD}
Model: ${MODEL}

Please analyze the repository and provide a plan. Then implement the changes.
Use the available tools to read files, write files, and use git.

Respond with:
1. A brief analysis of what needs to change
2. The specific files to modify
3. The implementation plan

Then implement the changes and commit them.`;

      const response = await callLLM([
        { role: 'system', content: 'You are a helpful coding assistant. You work in a sandboxed environment at /workspace. You can read/write files and use git.' },
        { role: 'user', content: prompt },
      ], MODEL);

      saveCheckpoint(3, { plan_generated: true, response_length: response.length });
      log('worker.plan_complete', { response_length: response.length });
    } catch (err) {
      log('worker.plan_failed', { error: err.message });
    }
  }

  // Step 4: Commit changes
  if (step < 4) {
    log('worker.commit');
    try {
      let status;
      if (mcpGit.tools.find(t => t.name === 'git_status')) {
        const res = await mcpGit.callTool('git_status', { repo: '.' });
        status = res.status;
      } else {
        const { execSync } = await import('child_process');
        status = execSync('git status --short', { cwd: WORKSPACE, encoding: 'utf-8' }).trim() || 'clean';
      }
      if (status !== 'clean') {
        if (mcpGit.tools.find(t => t.name === 'git_commit')) {
          await mcpGit.callTool('git_commit', { repo: '.', message: `agent(${TASK_ID}): implement ${GOAL.slice(0, 50)}` });
        } else {
          const { execSync } = await import('child_process');
          execSync('git add -A', { cwd: WORKSPACE });
          execSync(`git commit -m "agent(${TASK_ID}): implement ${GOAL.slice(0, 50)}"`, { cwd: WORKSPACE });
        }
        saveCheckpoint(4, { committed: true });
      }
    } catch (err) {
      log('worker.commit_failed', { error: err.message });
    }
  }

  // Cleanup MCP clients
  mcpFs.stop();
  mcpGit.stop();

  // Report completion
  log('worker.done', { spent_usd: spentUsd, spent_tokens: spentTokens });

  try {
    await fetch(`${ORCHESTRATOR_URL}/tasks/${TASK_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spent_usd: spentUsd, spent_tokens: spentTokens, summary: `Completed task ${TASK_ID}` }),
    });
  } catch (e) { /* ignore */ }
}

main().catch(err => {
  log('worker.fatal', { error: err.message });
  process.exit(1);
});
