# DEUK Dashboard — Static Lustre SPA served by nginx
FROM nginx:alpine@sha256:71dccb7e32a925fd5f8c65eb46c7b5fc8f1e1e7c7e0b7e0e7c7e0b7e0e7c7e0b7

# Copy built static assets
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as non-root
RUN sed -i 's/user  nginx;/user  agent;/g' /etc/nginx/nginx.conf || true
RUN addgroup -g 1000 agent && adduser -u 1000 -G agent -s /bin/sh -D agent
RUN chown -R agent:agent /usr/share/nginx/html /var/cache/nginx /var/log/nginx
USER agent

EXPOSE 7000

CMD ["nginx", "-g", "daemon off;"]
