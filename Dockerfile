# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG NODE_IMAGE=node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e

FROM ${NODE_IMAGE} AS build
ENV PATH="/opt/npm/bin:${PATH}"
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install --global --prefix /opt/npm npm@11.17.0 && npm ci

COPY index.html tokens.css tsconfig.json tsconfig.server.json vite.config.js ./
COPY shared ./shared
COPY src ./src
COPY server ./server

RUN npm run build && npm run build:server

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PATH="/opt/npm/bin:${PATH}" \
    HOST=0.0.0.0 \
    PORT=3001 \
    TRUST_PROXY_HOPS=0 \
    SHUTDOWN_TIMEOUT_MS=10000 \
    READINESS_CACHE_MS=10000
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install --global --prefix /opt/npm npm@11.17.0 \
  && npm ci --omit=dev \
  && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-dist ./server-dist

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "server-dist/server/index.js"]
