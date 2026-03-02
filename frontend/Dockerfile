# ──────────────────────────────────────────────────────────
# Frontend Dockerfile — React build + nginx
# Multi-stage: node build → nginx static serve
# ──────────────────────────────────────────────────────────

# ── Stage 1: Build React app ───────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Cache dependencies layer
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and build
COPY . .

# Production build — output goes to /app/build
ENV REACT_APP_API_BASE=/api
RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────
FROM nginx:1.27-alpine AS production

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy React build output
COPY --from=build /app/build /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy SSL certificates (optional — for HTTPS termination at nginx)
COPY ssl/cert.pem  /etc/nginx/ssl/cert.pem
COPY ssl/key.pem   /etc/nginx/ssl/key.pem

# Non-root nginx (alpine nginx runs as nginx user by default)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /etc/nginx/ssl

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:80/ || exit 1

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
