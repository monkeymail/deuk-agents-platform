# DEUK Orchestrator — TypeScript/Node.js
FROM node:22-alpine@sha256:71dccb7e32a925fd5f8c65eb46c7b5fc8f1e1e7c7e0b7e0e7c7e0b7e0e7c7e0b7

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY src/ ./src/
COPY config/ ./config/

# Create non-root user
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -s /bin/sh -D agent
USER agent

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:7001/health || exit 1

EXPOSE 7001

CMD ["node", "src/index.js"]
