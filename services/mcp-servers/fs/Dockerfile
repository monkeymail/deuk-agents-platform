# DEUK MCP — Filesystem
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install && npm cache clean --force
COPY src/ ./src/
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent
CMD ["node", "src/index.js"]
