# DEUK Dashboard — Static Lustre SPA served by nginx
FROM nginx:alpine

# Copy built static assets
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Run as non-root (nginx image already has nginx user)
RUN sed -i 's/user  nginx;/user  nginx;/g' /etc/nginx/nginx.conf || true
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx
USER nginx

EXPOSE 7000

CMD ["nginx", "-g", "daemon off;"]
