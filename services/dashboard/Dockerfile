# DEUK Dashboard — Simple static file server
FROM node:22-alpine

WORKDIR /app

# Copy and install service dependencies
COPY services/dashboard/package.json ./
RUN npm install && npm cache clean --force

# Link workspace package
RUN mkdir -p node_modules/@deuk && ln -s /app/packages/config node_modules/@deuk/config

# Copy built config package and service source
COPY packages/config/dist ./packages/config/dist
COPY packages/config/package.json ./packages/config/package.json
COPY services/dashboard/src/ ./src/
COPY services/dashboard/dist/ ./dist/

RUN addgroup -g 1001 agent && adduser -u 1001 -G agent -s /bin/sh -D agent
USER agent

EXPOSE 7000
CMD ["node", "src/server.js"]
