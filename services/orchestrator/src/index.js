/**
 * DEUK Orchestrator — Task queue, dispatch, state machine, worker spawning, GitHub webhooks
 * Uses centralized @deuk/config for all configuration.
 */
import express from 'express';
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';

// Centralized config — type-safe, IDE-validated, single source of truth
import {
  DEFAULTS,
  TaskCreateSchema,
  TaskStatus,
  parseConfig,
  TIER_DEFAULT_MODEL,
  SANDBOX_PROFILES,
} from '@deuk/config';

const cfg = parseConfig(process.env);

const app = express();
app.use(express.json());

// ─── Config (from centralized package) ───
const PORT = cfg.PORT || DEFAULTS.ORCHESTRATOR_PORT;
const DB_PATH = cfg.DATABASE_URL.replace('sqlite://', '');
const GATEWAY_URL = cfg.GATEWAY_URL;
const TASKS_DIR = cfg.TASKS_DIR;
const MAX_CONCURRENT_WORKERS = cfg.MAX_CONCURRENT_WORKERS;
const GH_WEBHOOK_SECRET = process.env.GH_WEBHOOK_SECRET || '';

// ─── Ensure dirs ───
if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });

// ─── SQLite Setup ───
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    issue INTEGER,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    tier TEXT NOT NULL DEFAULT 'worker',
    profile TEXT NOT NULL DEFAULT 'default',
    budget_usd REAL NOT NULL DEFAULT ${DEFAULTS.TASK_BUDGET_USD},
    budget_tokens INTEGER NOT NULL DEFAULT ${DEFAULTS.TASK_BUDGET_TOKENS},
    spent_usd REAL NOT NULL DEFAULT 0,
    spent_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Helpers ───
function generateTaskId() {
  const now = new Date();
  const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `T-${now.getFullYear()}-${seq}`;
}

function emitEvent(taskId, eventType, payload = null) {
  db.prepare('INSERT INTO events (task_id, event_type, payload) VALUES (?, ?, ?)')
    .run(taskId, eventType, payload ? JSON.stringify(payload) : null);
}

function getRunningCount() {
  return db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'running'").get().count;
}

// ─── Worker Spawning ───
function spawnWorker(task) {
  const taskDir = join(TASKS_DIR, task.id);
  if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });

  const profile = SANDBOX_PROFILES[task.profile] || SANDBOX_PROFILES['default'];
  const model = TIER_DEFAULT_MODEL[task.tier] || TIER_DEFAULT_MODEL['worker'];

  emitEvent(task.id, 'worker.spawning', { profile: task.profile, model });

  const args = [
    'run', '--rm',
    '--name', `deuk-worker-${task.id}`,
    '--network', profile.allowed_networks[0] || 'deuk-internal',
    '--security-opt', 'no-new-privileges:true',
    '--cap-drop', 'ALL',
    '-e', `TASK_ID=${task.id}`,
    '-e', `TASK_REPO=${task.repo}`,
    '-e', `TASK_GOAL=${task.goal}`,
    '-e', `TASK_TIER=${task.tier}`,
    '-e', `TASK_PROFILE=${task.profile}`,
    '-e', `TASK_BUDGET_USD=${task.budget_usd}`,
    '-e', `TASK_MODEL=${model}`,
    '-e', `GATEWAY_URL=${GATEWAY_URL}`,
    '-e', `ORCHESTRATOR_URL=http://orchestrator:${DEFAULTS.ORCHESTRATOR_PORT}`,
    '-v', `${taskDir}:/workspace`,
    'deuk-agents-worker:latest',
  ];

  const child = spawn('docker', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock' },
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          emitEvent(task.id, parsed.event || 'worker.stdout', parsed);
        } catch {
          emitEvent(task.id, 'worker.stdout', { line });
        }
      }
    }
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    const newStatus = code === 0 ? 'done' : 'failed';
    db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(newStatus, task.id);
    emitEvent(task.id, 'worker.exited', { code, status: newStatus });
  });

  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run('running', task.id);
  emitEvent(task.id, 'task.dispatched', { profile: task.profile, model });

  return child;
}

// ─── Dispatch Loop ───
function dispatchLoop() {
  const running = getRunningCount();
  if (running >= MAX_CONCURRENT_WORKERS) return;

  const slots = MAX_CONCURRENT_WORKERS - running;
  const queued = db.prepare("SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
    .all(slots);

  for (const task of queued) {
    try {
      spawnWorker(task);
    } catch (err) {
      emitEvent(task.id, 'worker.spawn_failed', { error: err.message });
      db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run('failed', task.id);
    }
  }
}

setInterval(dispatchLoop, 10000);

// ─── GitHub Webhook Verification ───
function verifyGitHubWebhook(req) {
  if (!GH_WEBHOOK_SECRET) return true; // Skip verification if no secret configured
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const hmac = createHmac('sha256', GH_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(req.body));
  const digest = 'sha256=' + hmac.digest('hex');
  return signature === digest;
}

// ─── Routes ───

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'orchestrator',
    version: cfg.DEUK_ENV === 'local' ? '0.2.0-local' : '0.2.0',
    running: getRunningCount(),
    max_concurrent: MAX_CONCURRENT_WORKERS,
  });
});

app.get('/tasks', (_req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all();
  res.json({ tasks });
});

app.get('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ task, events });
});

app.post('/tasks', (req, res) => {
  const parsed = TaskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  }

  const data = parsed.data;
  const taskId = generateTaskId();

  db.prepare(`
    INSERT INTO tasks (id, repo, issue, goal, tier, profile, budget_usd, budget_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, data.repo, data.issue ?? null, data.goal, data.tier, data.profile, data.budget_usd, data.budget_tokens);

  emitEvent(taskId, 'task.created', { repo: data.repo, goal: data.goal, tier: data.tier, profile: data.profile });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  res.status(201).json({ task });
});

app.patch('/tasks/:id', (req, res) => {
  const { status } = req.body;
  const validStatuses = TaskStatus.options;
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', allowed: validStatuses });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);

  emitEvent(req.params.id, 'status.changed', { from: task.status, to: status });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json({ task: updated });
});

app.post('/tasks/:id/spend', (req, res) => {
  const { spent_usd, spent_tokens } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare(`UPDATE tasks SET spent_usd = ?, spent_tokens = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(spent_usd || 0, spent_tokens || 0, req.params.id);

  emitEvent(req.params.id, 'budget.update', { spent_usd, spent_tokens });
  res.json({ ok: true });
});

app.post('/tasks/:id/complete', (req, res) => {
  const { spent_usd, spent_tokens, summary } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare(`UPDATE tasks SET status = ?, spent_usd = ?, spent_tokens = ?, updated_at = datetime('now') WHERE id = ?`)
    .run('done', spent_usd || 0, spent_tokens || 0, req.params.id);

  emitEvent(req.params.id, 'task.completed', { spent_usd, spent_tokens, summary });
  res.json({ ok: true });
});

// ─── GitHub Webhooks ───
app.post('/webhooks/github', (req, res) => {
  if (!verifyGitHubWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  log('webhook.received', { event, repo: payload.repository?.full_name });

  if (event === 'issues' && payload.action === 'opened') {
    const issue = payload.issue;
    const repo = payload.repository.full_name;
    const taskId = generateTaskId();

    db.prepare(`
      INSERT INTO tasks (id, repo, issue, goal, tier, profile, budget_usd, budget_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, repo, issue.number, issue.title, 'worker', 'default', DEFAULTS.TASK_BUDGET_USD, DEFAULTS.TASK_BUDGET_TOKENS);

    emitEvent(taskId, 'task.created', { repo, issue: issue.number, goal: issue.title, source: 'github_webhook' });
    return res.status(201).json({ task_id: taskId, message: 'Task created from issue' });
  }

  if (event === 'pull_request' && payload.action === 'opened') {
    const pr = payload.pull_request;
    const repo = payload.repository.full_name;
    // For PRs, we might want to trigger a review task
    const taskId = generateTaskId();

    db.prepare(`
      INSERT INTO tasks (id, repo, issue, goal, tier, profile, budget_usd, budget_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, repo, pr.number, `Review PR: ${pr.title}`, 'reviewer', 'default', 5.00, DEFAULTS.TASK_BUDGET_TOKENS);

    emitEvent(taskId, 'task.created', { repo, pr: pr.number, goal: pr.title, source: 'github_webhook' });
    return res.status(201).json({ task_id: taskId, message: 'Review task created from PR' });
  }

  res.json({ received: true, event });
});

function log(event, data = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    svc: 'orchestrator',
    event,
    ...data,
  }));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[orchestrator] Listening on http://0.0.0.0:${PORT}`);
});
