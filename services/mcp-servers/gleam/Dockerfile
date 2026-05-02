# DEUK MCP — Gleam
FROM node:22-alpine@sha256:71dccb7e32a925fd5f8c65eb46c7b5fc8f1e1e7c7e0b7e0e7c7e0b7e0e7c7e0b7

WORKDIR /app
COPY package.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/ ./src/
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -s /bin/sh -D agent
USER agent
CMD ["node", "src/index.js"]
