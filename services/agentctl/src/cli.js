#!/usr/bin/env node
/**
 * DEUK agentctl — Operator CLI
 * Commands: status, pause, resume, submit, show, kill, snapshot
 * Uses centralized @deuk/config for all configuration.
 */
import { Command } from 'commander';
import { parseConfig, DEFAULTS, Tier, Profile } from '@deuk/config';

const cfg = parseConfig(process.env);
const ORCHESTRATOR_URL = cfg.ORCHESTRATOR_URL;

const program = new Command();
program.name('agentctl').description('DEUK Agents operator CLI').version('0.2.0');

program
  .command('status')
  .description('Show platform status')
  .action(async () => {
    try {
      const [tasksRes, healthRes] = await Promise.all([
        fetch(`${ORCHESTRATOR_URL}/tasks`),
        fetch(`${ORCHESTRATOR_URL}/health`),
      ]);
      const data = await tasksRes.json();
      const health = await healthRes.json();
      const tasks = data.tasks || [];
      const active = tasks.filter(t => t.status === 'running').length;
      const queued = tasks.filter(t => t.status === 'queued').length;
      const awaiting = tasks.filter(t => t.status === 'awaiting-human').length;
      const done = tasks.filter(t => t.status === 'done').length;
      const failed = tasks.filter(t => t.status === 'failed').length;

      console.log('┌──────────────────┬───────────────────────────────────────────────┐');
      console.log(`│ Status           │ ${cfg.DEUK_ENV.padEnd(45)}│`);
      console.log(`│ Version          │ ${(health.version || 'unknown').padEnd(45)}│`);
      console.log(`│ Max concurrent   │ ${String(health.max_concurrent || cfg.MAX_CONCURRENT_WORKERS).padEnd(45)}│`);
      console.log(`│ Queued tasks     │ ${String(queued).padEnd(45)}│`);
      console.log(`│ Running tasks    │ ${String(active).padEnd(45)}│`);
      console.log(`│ Awaiting human   │ ${String(awaiting).padEnd(45)}│`);
      console.log(`│ Done             │ ${String(done).padEnd(45)}│`);
      console.log(`│ Failed           │ ${String(failed).padEnd(45)}│`);
      console.log(`│ Daily budget     │ $${String(cfg.DAILY_BUDGET_USD).padEnd(44)}│`);
      console.log(`│ Monthly budget   │ $${String(cfg.MONTHLY_BUDGET_USD).padEnd(44)}│`);
      console.log('└──────────────────┴───────────────────────────────────────────────┘');
    } catch (err) {
      console.error('Error:', err.message);
      console.log('Is the orchestrator running? docker compose up -d orchestrator');
      process.exit(1);
    }
  });

program
  .command('submit')
  .description('Submit a new task')
  .requiredOption('-r, --repo <repo>', 'Target repo')
  .requiredOption('-g, --goal <goal>', 'Task goal')
  .option('--tier <tier>', 'Agent tier', 'worker')
  .option('--profile <profile>', 'Sandbox profile', 'default')
  .option('--budget <usd>', 'Budget in USD', '2.50')
  .action(async (opts) => {
    const tier = Tier.options.includes(opts.tier) ? opts.tier : 'worker';
    const profile = Profile.options.includes(opts.profile) ? opts.profile : 'default';
    const budget = parseFloat(opts.budget);

    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: opts.repo,
          goal: opts.goal,
          tier,
          profile,
          budget_usd: budget,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Failed to submit task:', data.error || data);
        process.exit(1);
      }
      console.log(`✅ Task submitted: ${data.task.id}`);
      console.log(`   Repo:  ${data.task.repo}`);
      console.log(`   Goal:  ${data.task.goal}`);
      console.log(`   Tier:  ${data.task.tier}`);
      console.log(`   Budget: $${data.task.budget_usd}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('show <taskId>')
  .description('Show task details')
  .action(async (taskId) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks/${taskId}`);
      const data = await res.json();
      if (!res.ok) {
        console.error('Task not found:', taskId);
        process.exit(1);
      }
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('pause <taskId>')
  .description('Pause a running task')
  .action(async (taskId) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'blocked' }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Failed to pause task:', data.error);
        process.exit(1);
      }
      console.log(`⏸️  Task ${taskId} paused`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('resume <taskId>')
  .description('Resume a paused task')
  .action(async (taskId) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Failed to resume task:', data.error);
        process.exit(1);
      }
      console.log(`▶️  Task ${taskId} resumed`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('kill <taskId>')
  .description('Cancel a task')
  .action(async (taskId) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Failed to cancel task:', data.error);
        process.exit(1);
      }
      console.log(`🛑 Task ${taskId} cancelled`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('snapshot')
  .description('Create a platform snapshot')
  .action(async () => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks`);
      const data = await res.json();
      const snapshot = {
        ts: new Date().toISOString(),
        env: cfg.DEUK_ENV,
        tasks: data.tasks || [],
      };
      console.log(JSON.stringify(snapshot, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
