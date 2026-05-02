# DEUK Agents Platform

A personal autonomous software factory. Runs as a Docker Compose stack on Ubuntu 26.04. Uses AWS (eu-west-1) for hosted resources. Agents develop, test, and ship software while you’re at work.

## Quick start

```bash
cd /home/ubuntu/Documents/projects/deuk-agents-platform
cp .env.example .env
# Edit .env with your keys

docker compose up -d
# Dashboard: http://localhost:7000
# Orchestrator API: http://localhost:7001
```

## Architecture

- **Orchestrator** — task queue, dispatch, state machine, budget enforcement.
- **LLM Gateway** — proxy to OpenRouter with model allowlist, budget caps, scrubber.
- **Dashboard** — Lustre SPA for status, tasks, spend, PRs.
- **Worker sandboxes** — ephemeral containers spawned per task.
- **MCP servers** — typed tool interfaces for fs, git, gleam, docs.
- **Audit shipper** — structured logs → S3.
- **Self-hosted runner** — GitHub Actions runner in a sandbox container.

## Docs

See `docs/` for full specification:

| Doc | Topic |
|-----|-------|
| `00-vision-and-principles.md` | North star, success criteria, core principles |
| `01-architecture-overview.md` | Logical components, request flow, data flow |
| `02-security-and-sandboxing.md` | Threat model, defense layers, sandbox profiles |
| `03-host-laptop-setup.md` | Host bootstrap (Docker, git, nftables) |
| `04-aws-baseline.md` | AWS org, accounts, IAM, Terraform |
| `05-agent-orchestration.md` | Task lifecycle, state machine, tiers |
| `06-openrouter-and-models.md` | Model roster, routing, cost estimation |
| `07-mcp-tool-spec.md` | MCP server interface specification |
| `08-cicd-pipelines.md` | GitHub Actions, runner hardening, OIDC |
| `09-repo-standards.md` | Repo layout, Gleam/TS templates, lint rules |
| `10-observability-and-cost.md` | Logs, metrics, traces, dashboards, alerts |
| `11-local-dev-loop.md` | Inner dev loop, testing, debugging |
| `12-deploy-and-rollback.md` | Staging → prod, rollback, blue/green |
| `13-risk-register.md` | Known risks, mitigations, contingencies |
| `14-glossary-and-decisions.md` | ADRs, glossary, naming conventions |
| `15-preparation-report.md` | Bootstrap checklist, current status |

## Principles

1. **Type safety over cleverness** — Gleam for web apps, TS for glue, Python only for ML.
2. **Least privilege, always** — unprivileged containers, scoped AWS roles, short-lived secrets.
3. **Cost is a first-class constraint** — every task carries a budget; hard stop at £300/mo.
4. **Humans never lose** — agents work on branches, never `main`. One command pauses all agents.
5. **Boring & reproducible** — Terraform, pinned versions, immutable artefacts.

## Teardown

```bash
docker compose down -v
# Removes containers, networks, and named volumes.
# Bind-mounted workspaces in ./workspace/ are preserved until you rm -rf them.
```

## License

Private — personal use only.
