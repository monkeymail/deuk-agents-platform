# DEUK Agents Platform — Agent Standards

> **Version:** 0.2.0  
> **Last Updated:** 2026-05-02  
> **Applies to:** All AI agents, human contributors, and automated tools working in this repository.

---

## 1. Philosophy

**"Humans never lose"** — Every change must be reviewable, reversible, and attributable. Agents work in branches, open PRs, and never push directly to `main`.

**"Docker Compose first"** — The host is cattle. All services run in containers. The host only needs Docker, git, and nftables.

**"Type-safe config"** — No magic strings. No `process.env.MY_VAR` scattered through files. All configuration lives in `@deuk/config` and is validated at startup.

---

## 2. Repository Structure

```
deuk-agents-platform/
├── packages/           # Shared libraries (type-safe, published internally)
│   └── config/         # Centralized config schemas, constants, types
├── services/           # Docker services (each has Dockerfile, package.json, src/)
│   ├── orchestrator/   # Task queue, dispatch, state machine
│   ├── gateway/        # OpenRouter proxy with budget enforcement
│   ├── dashboard/      # Static SPA for monitoring
│   ├── worker/         # Agent sandbox (ephemeral containers)
│   ├── agentctl/       # Operator CLI
│   ├── audit-shipper/  # jsonl → S3
│   ├── gh-runner/      # GitHub Actions runner (ephemeral)
│   ├── otel-collector/ # OpenTelemetry collector
│   └── mcp-servers/    # MCP tool servers (fs, git, gleam)
├── infra/              # Terraform for AWS
├── scripts/            # Automation scripts (pr-create, pr-merge, etc.)
├── docs/               # Architecture docs, runbooks, ADRs
├── .github/workflows/  # CI/CD pipelines
└── docker-compose.yml  # Full platform stack
```

---

## 3. Configuration Standards

### 3.1 Centralized Config

**ALL** configuration must use `@deuk/config`:

```javascript
// ✅ CORRECT
import { parseConfig, DEFAULTS, TaskCreateSchema } from '@deuk/config';
const cfg = parseConfig(process.env);
const port = cfg.PORT || DEFAULTS.ORCHESTRATOR_PORT;

// ❌ WRONG
const port = process.env.PORT || 7001;
```

### 3.2 Adding New Config

1. Add the schema to `packages/config/src/index.ts`
2. Add a default to `DEFAULTS` if applicable
3. Export the type
4. Rebuild: `cd packages/config && npm run build`
5. Update consuming services

### 3.3 Environment Variables

- Use `SCREAMING_SNAKE_CASE`
- Prefix with `DEUK_` for platform-wide vars
- Document in `.env.example`
- Never commit secrets (use Bitwarden EU)

---

## 4. Code Standards

### 4.1 Language & Runtime

- **Node.js 22+** (Alpine for Docker)
- **ES Modules** (`"type": "module"` in package.json)
- **TypeScript** for shared packages (`packages/*`)
- **JSDoc** for service files (IDE type hints without full TS migration)

### 4.2 Imports

```javascript
// 1. Node built-ins
import { spawn } from 'child_process';

// 2. External packages
import express from 'express';

// 3. Internal packages
import { parseConfig } from '@deuk/config';

// 4. Local modules
import { myUtil } from './utils.js';
```

### 4.3 Error Handling

```javascript
// ✅ CORRECT — structured logging
try {
  await riskyOperation();
} catch (err) {
  log('operation.failed', { error: err.message, stack: err.stack });
  // Re-throw or handle gracefully
}

// ❌ WRONG — silent failures
try {
  await riskyOperation();
} catch (e) { /* ignore */ }
```

### 4.4 Logging

All services emit **structured JSON logs**:

```javascript
console.log(JSON.stringify({
  ts: new Date().toISOString(),
  svc: 'orchestrator',
  event: 'task.created',
  task_id: 'T-2026-0001',
  repo: 'deuk-agents/platform',
}));
```

Required fields: `ts`, `svc`, `event`

---

## 5. Model Registry

Models are defined in `@deuk/config`. **Never** hardcode model strings.

### 5.1 Current Models (2026-05-02)

| Model | Tier | Cost (in/out per 1K) |
|-------|------|---------------------|
| `openai/gpt-4.1` | orchestrator | $0.002 / $0.008 |
| `openai/gpt-4.1-mini` | worker | $0.0004 / $0.0016 |
| `openai/gpt-4.1-nano` | tester, scout | $0.0001 / $0.0004 |
| `anthropic/claude-opus-4-20250514` | orchestrator (complex) | $0.015 / $0.075 |
| `anthropic/claude-sonnet-4-20250514` | reviewer | $0.003 / $0.015 |
| `google/gemini-2.5-pro-preview-03-25` | worker (long context) | $0.00125 / $0.01 |

### 5.2 Adding a Model

1. Add to `ALLOWED_MODELS` in `packages/config/src/index.ts`
2. Add costs to `MODEL_COSTS`
3. Update `TIER_DEFAULT_MODEL` if needed
4. Rebuild config package
5. Update `.github/workflows/ci.yml` if model affects tests

---

## 6. Security Standards

### 6.1 Docker Security

Every service Dockerfile **must** include:

```dockerfile
# Non-root user
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent

# Read-only rootfs (where possible)
read_only: true

# Drop all capabilities
cap_drop:
  - ALL

# No new privileges
security_opt:
  - no-new-privileges:true
```

### 6.2 Secrets

- **Never** commit secrets to git
- Use Bitwarden EU for local development
- Use AWS Secrets Manager in production
- Use GitHub Secrets for CI/CD

### 6.3 GDPR Compliance

- No PII in logs
- Gateway scrubs: credit cards, SSNs, API keys
- Audit logs retained for 90 days max
- EU data residency (AWS eu-west-1)

---

## 7. Git Workflow

### 7.1 Branch Naming

```
feature/<name>     # New features
fix/<name>         # Bug fixes
docs/<name>        # Documentation
refactor/<name>    # Code refactoring
security/<name>    # Security patches
```

### 7.2 Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gateway): add budget enforcement
fix(worker): handle git clone failures
docs: update AGENTS.md
refactor(orchestrator): extract spawn logic
security: rotate API keys
```

### 7.3 PR Requirements

1. **All CI checks must pass** (lint, typecheck, test, docker build, security scan)
2. **PR title** must follow conventional commits
3. **Description** must include:
   - What changed
   - Why it changed
   - How to test
   - Budget implications (if any)
4. **No direct pushes to `main`**

### 7.4 Merging

- Use **squash merge** for feature branches
- Delete branch after merge
- Verify CI passes on `main` after merge

---

## 8. CI/CD Standards

### 8.1 Required Checks

| Check | Tool | Fail Strategy |
|-------|------|---------------|
| Lint | ESLint | Block merge |
| Typecheck | TypeScript | Block merge |
| Test | Vitest / Node test runner | Block merge |
| Docker Build | Docker Buildx | Block merge |
| Security Scan | Trivy + TruffleHog | Block merge |
| Compose Validate | `docker compose config` | Block merge |

### 8.2 Running Checks Locally

```bash
# Lint all packages
npm run lint --workspaces --if-present

# Typecheck all packages
npm run typecheck --workspaces --if-present

# Test all packages
npm run test --workspaces --if-present

# Build all Docker images
docker compose build

# Validate compose file
docker compose config
```

---

## 9. MCP Server Standards

### 9.1 Protocol

- **Transport:** stdio with Content-Length framing
- **Format:** JSON-RPC 2.0
- **Required methods:** `initialize`, `tools/list`, `tools/call`

### 9.2 Tool Definition

```javascript
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within workspace' },
      },
      required: ['path'],
    },
  },
];
```

### 9.3 Security

- All paths resolved relative to `/workspace`
- Path traversal blocked (`..` rejected)
- No network access unless explicitly allowed

---

## 10. Budget & Cost Standards

### 10.1 Default Budgets

| Tier | Per-Task Budget | Daily Budget | Monthly Budget |
|------|----------------|--------------|----------------|
| scout | $0.50 | — | — |
| worker | $2.50 | — | — |
| reviewer | $5.00 | — | — |
| orchestrator | $10.00 | — | — |
| Platform | — | $6.67 | $200 |

### 10.2 Cost Tracking

- Gateway tracks daily/monthly spend
- Worker tracks per-task spend
- Orchestrator aggregates
- Audit shipper logs to S3

### 10.3 Hard Limits

- **Hard budget:** $300/month (gateway blocks all requests)
- **Rate limit:** 60 RPM per gateway instance
- **Max concurrent workers:** 3 (configurable)

---

## 11. Testing Standards

### 11.1 Unit Tests

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { calculateCost } from '../src/budget.js';

test('calculateCost computes correctly', () => {
  const cost = calculateCost(1000, 500, 'openai/gpt-4.1-mini');
  assert.strictEqual(cost, 0.0004 + 0.0003); // $0.0007
});
```

### 11.2 Integration Tests

- Test against real Docker containers where possible
- Use `testcontainers` for ephemeral services
- Mock external APIs (OpenRouter, GitHub)

### 11.3 Coverage

- Minimum 70% coverage for shared packages
- Minimum 50% coverage for services
- Coverage reported in CI

---

## 12. Documentation Standards

### 12.1 Code Documentation

- JSDoc for all exported functions
- README.md in every service directory
- Architecture Decision Records (ADRs) in `docs/adr/`

### 12.2 Runbooks

- `docs/runbooks/` for operational procedures
- Include: incident response, rollback, scaling

---

## 13. Agent Behavior

### 13.1 What Agents MUST Do

1. Work in a feature branch
2. Run all checks before committing
3. Open a PR for review
4. Wait for CI to pass
5. Respond to review comments
6. Never commit secrets
7. Never exceed budget without approval

### 13.2 What Agents MUST NOT Do

1. Push directly to `main`
2. Skip CI checks
3. Commit `.env` files
4. Hardcode API keys
5. Use models not in `ALLOWED_MODELS`
6. Ignore security scan results
7. Merge their own PRs without review

---

## 14. Review Checklist

For human reviewers:

- [ ] Code follows this AGENTS.md
- [ ] Config uses `@deuk/config`
- [ ] No secrets in code
- [ ] Docker security options present
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Budget implications considered
- [ ] GDPR compliance maintained

---

## 15. Enforcement

- CI enforces lint, typecheck, test, security
- Branch protection requires PR + review + passing checks
- `scripts/pr-create.js` and `scripts/pr-merge.js` automate workflow
- Non-compliance blocks merge

---

**Questions?** Open an issue or ask in `#deuk-dev`.
