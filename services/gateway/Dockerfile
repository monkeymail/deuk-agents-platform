# DEUK LLM Gateway — TypeScript/Node.js
FROM node:22-alpine

WORKDIR /app

# Copy and install service dependencies
COPY services/gateway/package.json ./
RUN npm install && npm cache clean --force

# Link workspace package
RUN mkdir -p node_modules/@deuk && ln -s /app/packages/config node_modules/@deuk/config

# Copy built config package and service source
COPY packages/config/dist ./packages/config/dist
COPY packages/config/package.json ./packages/config/package.json
COPY services/gateway/src/ ./src/

RUN apk add --no-cache wget

RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:7100/health || exit 1

EXPOSE 7100

CMD ["node", "src/index.js"]
