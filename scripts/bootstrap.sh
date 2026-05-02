#!/usr/bin/env bash
# Bootstrap script: verify host, create .env, pull images, start core services.
# Usage: bash scripts/bootstrap.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== DEUK Agents Platform Bootstrap ==="
echo ""

# 1. Host readiness
echo "→ Running host verification..."
bash "$PROJECT_ROOT/scripts/verify-host.sh" || {
  echo "Host verification failed. Fix issues before continuing."
  exit 1
}
echo ""

# 2. .env check
if [[ ! -f .env ]]; then
  echo "→ Creating .env from template..."
  cp .env.example .env
  echo "  🟡 Please edit .env with your actual secrets, then re-run this script."
  exit 0
fi

# 3. Docker Compose validation
echo "→ Validating docker-compose.yml..."
docker compose config > /dev/null
echo "  ✅ Compose file valid"
echo ""

# 4. Pull & build
echo "→ Pulling base images and building services..."
docker compose pull
docker compose build
echo ""

# 5. Start core services
echo "→ Starting core services (orchestrator, gateway, dashboard, postgres, redis)..."
docker compose up -d orchestrator gateway dashboard postgres redis
echo ""

# 6. Health checks
echo "→ Waiting for health checks..."
sleep 5
for svc in orchestrator gateway dashboard postgres redis; do
  if docker compose ps "$svc" | grep -q "healthy"; then
    echo "  ✅ $svc healthy"
  else
    echo "  🟡 $svc not healthy yet (check logs: docker compose logs $svc)"
  fi
done
echo ""

# 7. Summary
echo "=== Bootstrap complete ==="
echo "Dashboard:  http://localhost:7000"
echo "Orchestrator API: http://localhost:7001"
echo ""
echo "Next steps:"
echo "  1. Review .env and set real API keys."
echo "  2. Run 'docker compose up -d' to start all services."
echo "  3. See docs/15-preparation-report.md for AWS setup."
