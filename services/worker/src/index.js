/**
 * DEUK Worker — Autonomous agent executing tasks via Vercel AI SDK + ReAct loop
 *
 * Uses:
 *   - @openrouter/ai-sdk-provider  — provider abstraction (swap to openai/anthropic via env)
 *   - ai (Vercel AI SDK)           — generateText with tool calling, usage tracking
 *   - @ai-sdk/mcp                  — MCP client (replaces hand-rolled stdio client)
 *   - @modelcontextprotocol/sdk    — StdioClientTransport for local MCP servers
 *
 * Flow:
 *   1. Clone repo → create feature branch
 *   2. ReAct loop: generateText with tools → LLM picks tools → execute → observe → repeat
 *   3. Commit → push branch → open PR via GitHub API
 *   4. Report completion to orchestrator
 */
import { execSync } from 'child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  DEFAULTS,
  parseConfig,
  FALLBACK_MODEL_COSTS,
  TIER_DEFAULT_MODEL,
  getProviderConfig,
} from '@deuk/config';

const cfg = parseConfig(process.env);
const providerCfg = getProviderConfig(cfg);

// ─── Task Config ─────────────────────────────────────────────────────────────
const TASK_ID    = process.env.TASK_ID    || 'unknown';
const REPO       = process.env.TASK_REPO  || '';
const GOAL       = process.env.TASK_GOAL  || '';
const TIER       = process.env.TASK_TIER  || 'worker';
const PROFILE    = process.env.TASK_PROFILE || 'default';
const BUDGET_USD = parseFloat(process.env.TASK_BUDGET_USD || String(DEFAULTS.TASK_BUDGET_USD));
const MODEL_ID   = process.env.TASK_MODEL || TIER_DEFAULT_MODEL[TIER] || TIER_DEFAULT_MODEL['worker'];
const WORKSPACE  = DEFAULTS.WORKSPACE;
const GH_TOKEN   = process.env.GH_TOKEN || cfg.GH_TOKEN || '';
const MAX_STEPS  = parseInt(process.env.MAX_REACT_STEPS || '20', 10);

// ─── State ───────────────────────────────────────────────────────────────────
let spentUsd    = 0;
let spentTokens = 0;
const checkpointPath = join(WORKSPACE, '.deuk-checkpoint.json');

// ─── Logging ─────────────────────────────────────────────────────────────────
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

// ─── Checkpoint ──────────────────────────────────────────────────────────────
function saveCheckpoint(step, data = {}) {
  try {
    const existing = loadCheckpoint() || {};
    writeFileSync(checkpointPath, JSON.stringify({ ...existing, step, ...data, ts: Date.now() }));
  } catch { /* ignore */ }
}

function loadCheckpoint() {
  if (!existsSync(checkpointPath)) return null;
  try { return JSON.parse(readFileSync(checkpointPath, 'utf-8')); }
  catch { return null; }
}

// ─── Build AI SDK model instance ─────────────────────────────────────────────
function buildModel() {
  const { provider, apiKey, baseUrl } = providerCfg;

  if (provider === 'openrouter') {
    const openrouter = createOpenRouter({ apiKey, baseURL: baseUrl });
    return openrouter.chat(MODEL_ID);
  }
  if (provider === 'openai') {
    const openai = createOpenAI({ apiKey, baseURL: baseUrl });
    return openai(MODEL_ID);
  }
  if (provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey, baseURL: baseUrl });
    return anthropic(MODEL_ID);
  }
  // custom — use openai-compatible
  const openai = createOpenAI({ apiKey, baseURL: baseUrl });
  return openai(MODEL_ID);
}

// ─── Cost tracking ────────────────────────────────────────────────────────────
function trackUsage(usage) {
  if (!usage) return;
  const costs = FALLBACK_MODEL_COSTS[MODEL_ID] || { in: 0.003, out: 0.015 };
  const cost = ((usage.promptTokens || 0) / 1000) * costs.in
             + ((usage.completionTokens || 0) / 1000) * costs.out;
  spentUsd    += cost;
  spentTokens += (usage.totalTokens || 0);
  log('llm.usage', {
    model: MODEL_ID,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    cost_usd: cost,
    spent_usd: spentUsd,
  });
  reportSpend().catch(() => {});
}

async function reportSpend() {
  try {
    await fetch(`${cfg.ORCHESTRATOR_URL}/tasks/${TASK_ID}/spend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spent_usd: spentUsd, spent_tokens: spentTokens }),
    });
  } catch { /* ignore */ }
}

// ─── ReAct Loop via Vercel AI SDK ────────────────────────────────────────────
async function runReActLoop(mcpTools) {
  if (spentUsd >= BUDGET_USD) {
    return { summary: `Budget exhausted ($${spentUsd.toFixed(4)})`, blocked: true };
  }

  const model = buildModel();

  const systemPrompt = `You are a ${TIER} coding agent (task ${TASK_ID}).

GOAL: ${GOAL}
WORKSPACE: /workspace (repo cloned here)
PROFILE: ${PROFILE}
BUDGET: $${BUDGET_USD} USD (spent so far: $${spentUsd.toFixed(4)})

You have filesystem and git tools. Use them to:
1. Explore the repository (list_dir, read_file)
2. Understand what needs to change
3. Write changes (write_file)
4. Verify with git_status and git_diff
5. When done, say DONE: <one-line summary>

Rules:
- Explore before editing. Read relevant files first.
- Make minimal, focused changes.
- Write tests if the repo has a test directory.
- Commit message format: "agent(${TASK_ID}): <what changed>"
- If blocked, say BLOCKED: <reason>
- Never expose secrets or credentials.`;

  log('react.start', { model: MODEL_ID, max_steps: MAX_STEPS, tools: Object.keys(mcpTools) });

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: 'Start by exploring the repository at /workspace, then implement the goal.',
      tools: mcpTools,
      maxSteps: MAX_STEPS,
      onStepFinish: ({ usage, toolCalls, toolResults }) => {
        trackUsage(usage);
        if (toolCalls?.length) {
          log('react.step', {
            tools_called: toolCalls.map(tc => tc.toolName),
            results: toolResults?.length,
          });
        }
      },
    });

    const text = result.text || '';
    if (text.includes('DONE:')) {
      const summary = text.split('DONE:')[1]?.trim() || 'Task completed';
      log('react.done', { summary: summary.slice(0, 200) });
      return { summary, blocked: false };
    }
    if (text.includes('BLOCKED:')) {
      const reason = text.split('BLOCKED:')[1]?.trim() || 'Unknown reason';
      log('react.blocked', { reason });
      return { summary: `BLOCKED: ${reason}`, blocked: true };
    }

    return { summary: result.text?.slice(0, 200) || 'Completed', blocked: false };
  } catch (err) {
    log('react.error', { error: err.message });
    return { summary: `Error: ${err.message}`, blocked: false };
  }
}

// ─── Git helpers ─────────────────────────────────────────────────────────────
function gitExec(cmd, opts = {}) {
  return execSync(cmd, { cwd: WORKSPACE, encoding: 'utf-8', timeout: 60000, ...opts });
}

function createFeatureBranch() {
  const branch = `agent/${TASK_ID}/feature`;
  try {
    gitExec(`git checkout -b ${branch}`);
    log('git.branch_created', { branch });
  } catch {
    try {
      gitExec(`git checkout ${branch}`);
      log('git.branch_switched', { branch });
    } catch (e) {
      log('git.branch_failed', { error: e.message });
      return null;
    }
  }
  return branch;
}

function commitChanges() {
  try {
    const status = gitExec('git status --short').trim();
    if (!status) { log('git.nothing_to_commit'); return false; }
    gitExec('git add -A');
    const msg = `agent(${TASK_ID}): ${GOAL.slice(0, 72)}`;
    gitExec(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
    log('git.committed', { files: status.split('\n').length });
    return true;
  } catch (err) {
    log('git.commit_failed', { error: err.message });
    return false;
  }
}

async function pushBranch(branch) {
  try {
    if (GH_TOKEN && REPO) {
      const remote = `https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git`;
      gitExec(`git remote set-url origin ${remote}`);
    }
    gitExec(`git push -u origin ${branch}`);
    log('git.pushed', { branch });
    return true;
  } catch (err) {
    log('git.push_failed', { error: err.message });
    return false;
  }
}

async function openPullRequest(branch, summary) {
  if (!GH_TOKEN || !REPO) {
    log('pr.skipped', { reason: !GH_TOKEN ? 'no_gh_token' : 'no_repo' });
    return null;
  }
  const title = `agent(${TASK_ID}): ${GOAL.slice(0, 80)}`;
  const body = [
    `## 🤖 Agent Task \`${TASK_ID}\``,
    '',
    `**Goal:** ${GOAL}`,
    `**Tier:** ${TIER}  |  **Model:** ${MODEL_ID}  |  **Profile:** ${PROFILE}`,
    `**Cost:** $${spentUsd.toFixed(4)} of $${BUDGET_USD} budget`,
    `**Tokens:** ${spentTokens.toLocaleString()}`,
    '',
    '## Summary',
    summary,
    '',
    '---',
    '_Generated by DEUK agent platform. Review before merging._',
  ].join('\n');

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title, body, head: branch, base: 'main' }),
    });
    const data = await res.json();
    if (!res.ok) { log('pr.failed', { status: res.status, error: data.message }); return null; }
    log('pr.opened', { number: data.number, url: data.html_url });
    return { number: data.number, url: data.html_url };
  } catch (err) {
    log('pr.error', { error: err.message });
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('worker.started', {
    repo: REPO, goal: GOAL, tier: TIER, profile: PROFILE,
    budget: BUDGET_USD, model: MODEL_ID, provider: providerCfg.provider,
  });

  mkdirSync(WORKSPACE, { recursive: true });

  // Start MCP servers via @ai-sdk/mcp + StdioClientTransport
  let mcpTools = {};
  const mcpClients = [];

  try {
    const fsClient = await createMCPClient({
      transport: new StdioClientTransport({
        command: 'node',
        args: ['/app/mcp-servers/fs/src/index.js'],
      }),
    });
    const gitClient = await createMCPClient({
      transport: new StdioClientTransport({
        command: 'node',
        args: ['/app/mcp-servers/git/src/index.js'],
      }),
    });
    mcpClients.push(fsClient, gitClient);

    // Merge tools from both MCP servers
    const [fsTools, gitTools] = await Promise.all([
      fsClient.tools(),
      gitClient.tools(),
    ]);
    mcpTools = { ...fsTools, ...gitTools };
    log('mcp.ready', { tools: Object.keys(mcpTools) });
  } catch (err) {
    log('mcp.start_failed', { error: err.message });
  }

  const cp = loadCheckpoint();
  let step   = cp?.step || 0;
  let branch = cp?.branch || null;
  if (step > 0) log('worker.resume', { from_step: step });

  // Step 1: Clone repo
  if (step < 1 && REPO) {
    log('worker.step', { step: 1, name: 'clone' });
    try {
      gitExec(`git clone --depth 50 "https://github.com/${REPO}.git" .`);
      gitExec('git config user.email "agent@deuk.local"');
      gitExec('git config user.name "DEUK Agent"');
      saveCheckpoint(1, { cloned: REPO });
      step = 1;
    } catch (err) {
      log('worker.clone_failed', { error: err.message });
    }
  }

  // Step 2: Create feature branch
  if (step < 2) {
    log('worker.step', { step: 2, name: 'branch' });
    branch = createFeatureBranch();
    saveCheckpoint(2, { branch });
    step = 2;
  }

  // Step 3: ReAct loop
  if (step < 3) {
    log('worker.step', { step: 3, name: 'react_loop' });
    const result = await runReActLoop(mcpTools);
    saveCheckpoint(3, { react_summary: result.summary, react_blocked: result.blocked });
    step = 3;
  }

  // Step 4: Commit
  if (step < 4) {
    log('worker.step', { step: 4, name: 'commit' });
    const committed = commitChanges();
    saveCheckpoint(4, { committed });
    step = 4;
  }

  // Step 5: Push
  if (step < 5) {
    log('worker.step', { step: 5, name: 'push' });
    const pushed = branch ? await pushBranch(branch) : false;
    saveCheckpoint(5, { pushed });
    step = 5;
  }

  // Step 6: Open PR
  if (step < 6) {
    log('worker.step', { step: 6, name: 'open_pr' });
    const finalCp = loadCheckpoint();
    const summary = finalCp?.react_summary || GOAL;
    const pr = branch ? await openPullRequest(branch, summary) : null;
    saveCheckpoint(6, { pr });
  }

  // Cleanup MCP clients
  for (const client of mcpClients) {
    try { await client.close(); } catch { /* ignore */ }
  }

  log('worker.done', { spent_usd: spentUsd, spent_tokens: spentTokens, branch });

  try {
    const finalCp = loadCheckpoint();
    await fetch(`${cfg.ORCHESTRATOR_URL}/tasks/${TASK_ID}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spent_usd:    spentUsd,
        spent_tokens: spentTokens,
        summary:      finalCp?.react_summary || `Completed task ${TASK_ID}`,
        branch,
        pr:           finalCp?.pr || null,
      }),
    });
  } catch { /* ignore */ }
}

main().catch(err => {
  log('worker.fatal', { error: err.message, stack: err.stack?.slice(0, 500) });
  process.exit(1);
});
