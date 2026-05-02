#!/usr/bin/env node
/**
 * DEUK PR Merge — Merge a PR after all checks pass
 * Usage: node scripts/pr-merge.js <pr-number>
 */
import { execSync } from 'child_process';

const prNumber = process.argv[2];

if (!prNumber) {
  console.error('Usage: node scripts/pr-merge.js <pr-number>');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', ...opts });
}

// Check PR status
console.log(`Checking PR #${prNumber} status...`);
const prInfo = execSync(`gh pr view ${prNumber} --json state,mergeStateStatus,checks`, { encoding: 'utf-8' });
const pr = JSON.parse(prInfo);

if (pr.state !== 'OPEN') {
  console.error(`❌ PR #${prNumber} is not open (state: ${pr.state})`);
  process.exit(1);
}

if (pr.mergeStateStatus !== 'CLEAN' && pr.mergeStateStatus !== 'UNSTABLE') {
  console.error(`❌ PR #${prNumber} cannot be merged (status: ${pr.mergeStateStatus})`);
  process.exit(1);
}

// Check if all required checks passed
const failedChecks = pr.checks?.filter(c => c.conclusion === 'FAILURE') || [];
if (failedChecks.length > 0) {
  console.error('❌ Some checks failed:');
  for (const check of failedChecks) {
    console.error(`   - ${check.name}: ${check.conclusion}`);
  }
  process.exit(1);
}

// Merge the PR
console.log(`✅ All checks passed. Merging PR #${prNumber}...`);
run(`gh pr merge ${prNumber} --squash --delete-branch`);
console.log(`🎉 PR #${prNumber} merged successfully!`);
