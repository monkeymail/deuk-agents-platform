#!/usr/bin/env node
/**
 * DEUK PR Create — Create a feature branch and open a PR with proper checks
 * Usage: node scripts/pr-create.js <feature-name> [base-branch]
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const featureName = process.argv[2];
const baseBranch = process.argv[3] || 'main';

if (!featureName) {
  console.error('Usage: node scripts/pr-create.js <feature-name> [base-branch]');
  process.exit(1);
}

const branchName = `feature/${featureName}`;

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf-8', stdio: 'inherit', ...opts });
}

// Check for uncommitted changes
const status = execSync('git status --short', { encoding: 'utf-8' }).trim();
if (status) {
  console.error('❌ Uncommitted changes detected. Commit or stash them first.');
  console.error(status);
  process.exit(1);
}

// Create and switch to feature branch
run(`git checkout -b ${branchName} ${baseBranch}`);

// Push branch to origin
run(`git push -u origin ${branchName}`);

// Create PR using gh CLI if available
try {
  const prBody = `## Changes
- ${featureName}

## Checklist
- [ ] Code follows DEUK standards (see AGENTS.md)
- [ ] Tests pass locally
- [ ] Docker builds successfully
- [ ] No secrets committed
- [ ] Budget implications considered

## Type
- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor
- [ ] security
`;
  run(`gh pr create --base ${baseBranch} --head ${branchName} --title "feat: ${featureName}" --body "${prBody}"`);
} catch {
  console.log(`\n✅ Branch ${branchName} created and pushed.`);
  console.log(`   Open a PR at: https://github.com/${getRepoUrl()}/compare/${baseBranch}...${branchName}`);
}

function getRepoUrl() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    return remote.replace(/^git@github.com:/, '').replace(/\.git$/, '');
  } catch {
    return 'deuk-agents/deuk-agents-platform';
  }
}
