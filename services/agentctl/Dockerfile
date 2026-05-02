# DEUK agentctl — Operator CLI
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install && npm cache clean --force
COPY src/ ./src/
RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent
ENTRYPOINT ["node", "src/cli.js"]
