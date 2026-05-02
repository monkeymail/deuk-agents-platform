# DEUK MCP — Gleam
FROM node:22-alpine

WORKDIR /app

# Copy and install service dependencies
COPY services/mcp-servers/gleam/package.json ./
RUN npm install && npm cache clean --force

# Link workspace package
RUN mkdir -p node_modules/@deuk && ln -s /app/packages/config node_modules/@deuk/config

# Copy built config package and service source
COPY packages/config/dist ./packages/config/dist
COPY packages/config/package.json ./packages/config/package.json
COPY services/mcp-servers/gleam/src/ ./src/

RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent
CMD ["node", "src/index.js"]
