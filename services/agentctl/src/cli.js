#!/usr/bin/env node
/**
 * DEUK agentctl — Operator CLI
 * Commands: status, pause, resume, submit, show, kill, snapshot
 */
import { Command } from 'commander';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:7001';

const program = new Command();
program.name('agentctl').description('DEUK Agents operator CLI').version('0.1.0');

program
  .command('status')
  .description('Show platform status')
  .action(async () => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks`);
      const data = await res.json();
      const tasks = data.tasks || [];
      const active = tasks.filter(t => t.status === 'running').length;
      const queued = tasks.filter(t => t.status === 'queued').length;
      const awaiting = tasks.filter(t => t.status === 'awaiting-human').length;
      const done = tasks.filter(t => t.status === 'done').length;
      const failed = tasks.filter(t => t.status === 'failed').length;

      console.log('┌──────────────────┬───────────────────────────────────────────────┐');
      console.log('│ Status           │ local                                         │');
      console.log(`│ Queued tasks     │ ${String(queued).padEnd(45)}│`);
      console.log(`│ Running tasks    │ ${String(active).padEnd(45)}│`);
      console.log(`│ Awaiting human   │ ${String(awaiting).padEnd(45)}│`);
      console.log(`│ Done today       │ ${String(done).padEnd(45)}│`);
      console.log(`│ Failed           │ ${String(failed).padEnd(45)}│`);
      console.log('│ Today\'s spend    │ £0.00 (set OPENROUTER_API_KEY to track)       │');
      console.log('│ Month spend      │ £0.00                                         │');
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
  .option('--budget <usd>', 'Budget in USD', '2.50')
  .action(async (opts) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: opts.repo,
          goal: opts.goal,
          tier: opts.tier,
          budget_usd: parseFloat(opts.budget),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`Task created: ${data.task.id}`);
        console.log(`Status: ${data.task.status}`);
        console.log(`Budget: £${data.task.budget_usd.toFixed(2)}`);
      } else {
        console.error('Failed:', data.error);
        process.exit(1);
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('show <id>')
  .description('Show task details')
  .action(async (id) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/tasks/${id}`);
      const data = await res.json();
      if (!res.ok) {
        console.error('Not found:', id);
        process.exit(1);
      }
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program
  .command('pause')
  .description('Pause all agents (placeholder)')
  .action(() => {
    console.log('Pause: not yet implemented. Set ORCHESTRATOR_PAUSED=true env var.');
  });

program
  .command('resume')
  .description('Resume all agents (placeholder)')
  .action(() => {
    console.log('Resume: not yet implemented. Unset ORCHESTRATOR_PAUSED env var.');
  });

program
  .command('kill <id>')
  .description('Kill a task (placeholder)')
  .action((id) => {
    console.log(`Kill ${id}: not yet implemented.`);
  });

program
  .command('snapshot')
  .description('Snapshot state (placeholder)')
  .action(() => {
    console.log('Snapshot: not yet implemented.');
  });

program.parse();
