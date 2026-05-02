# DEUK MCP — Git
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/ ./src/
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -s /bin/sh -D agent
USER agent
CMD ["node", "src/index.js"]
