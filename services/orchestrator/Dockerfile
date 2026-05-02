# DEUK Orchestrator — TypeScript/Node.js
FROM node:22-alpine

WORKDIR /app

# Install build deps for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install && npm cache clean --force

# Copy source
COPY src/ ./src/
COPY config/ ./config/

# Create non-root user and data dir
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
RUN mkdir -p /data && chown -R agent:agent /data

# Install wget for healthcheck
RUN apk add --no-cache wget

USER agent

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:7001/health || exit 1

EXPOSE 7001

CMD ["node", "src/index.js"]
