# DEUK GitHub Actions Self-Hosted Runner
FROM summerwind/actions-runner:latest

USER root

# Install Docker CLI (for container jobs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Harden: drop caps, read-only rootfs handled by Compose
RUN addgroup --gid 1000 agent && adduser --uid 1000 --ingroup agent --shell /bin/bash agent || true

USER runner

# Ephemeral mode: runner registers, runs one job, then de-registers
ENV RUNNER_EPHEMERAL=true
