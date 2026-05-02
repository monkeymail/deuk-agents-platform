# DEUK Worker — Agent sandbox container
FROM node:22-alpine

# Install git and basic tools
RUN apk add --no-cache git bash curl

WORKDIR /workspace

# Copy and install service dependencies
COPY services/worker/package.json ./
RUN npm install && npm cache clean --force

# Link workspace package
RUN mkdir -p node_modules/@deuk && ln -s /workspace/packages/config node_modules/@deuk/config

# Copy built config package and service source
COPY packages/config/dist ./packages/config/dist
COPY packages/config/package.json ./packages/config/package.json
COPY services/worker/src/ ./src/

# Create non-root user
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent

# No entrypoint — orchestrator sets env vars and runs: node src/index.js
CMD ["node", "src/index.js"]
