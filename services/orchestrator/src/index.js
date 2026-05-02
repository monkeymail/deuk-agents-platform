/**
 * DEUK Orchestrator — Minimal bootstrap version
 * Handles: health, task creation, basic state machine
 */
import express from 'express';
import Database from 'better-sqlite3';
import { z } from 'zod';

const app = express();
app.use(express.json());

// ─── Config ───
const PORT = process.env.PORT || 7001;
const DB_PATH = process.env.DATABASE_URL?.replace('sqlite://', '') || '/data/orchestrator.db';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:7100';

// ─── SQLite Setup ───
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Tasks table
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    issue INTEGER,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    tier TEXT NOT NULL DEFAULT 'worker',
    profile TEXT NOT NULL DEFAULT 'default',
    budget_usd REAL NOT NULL DEFAULT 2.50,
    budget_tokens INTEGER NOT NULL DEFAULT 2000000,
    spent_usd REAL NOT NULL DEFAULT 0,
    spent_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Events table (append-only)
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Validation ───
const TaskCreateSchema = z.object({
  repo: z.string().min(1),
  issue: z.number().int().optional(),
  goal: z.string().min(1),
  tier: z.enum(['orchestrator', 'reviewer', 'worker', 'tester', 'scout']).default('worker'),
  profile: z.enum(['readonly-scout', 'default', 'default-gleam', 'default-ts', 'deploy-staging']).default('default'),
  budget_usd: z.number().positive().default(2.50),
  budget_tokens: z.number().int().positive().default(2000000),
});

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

// ─── Routes ───

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'orchestrator', version: '0.1.0' });
});

// List tasks
app.get('/tasks', (_req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100').all();
  res.json({ tasks });
});

// Get single task
app.get('/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY created_at').all(req.params.id);
  res.json({ task, events });
});

// Create task
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

  emitEvent(taskId, 'task.created', { repo: data.repo, goal: data.goal });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  res.status(201).json({ task });
});

// Update task status
app.patch('/tasks/:id', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['queued', 'running', 'awaiting-human', 'blocked', 'done', 'failed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare('UPDATE tasks SET status = ?, updated_at = datetime("now") WHERE id = ?')
    .run(status, req.params.id);

  emitEvent(req.params.id, 'status.changed', { from: task.status, to: status });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json({ task: updated });
});

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[orchestrator] Listening on http://0.0.0.0:${PORT}`);
});
