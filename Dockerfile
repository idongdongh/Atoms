# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install workspace dependencies and compile every package.
# ---------------------------------------------------------------------------
FROM node:24-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.33.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY templates ./templates
RUN pnpm install --frozen-lockfile
RUN pnpm -r --if-present build
# Pre-install the generated-app template's dependencies so every new project
# starts its preview instantly (node_modules ship inside the image; the
# workspace-level install then becomes a no-op).
RUN pnpm --dir templates/react-vite install --ignore-workspace --frozen-lockfile

# ---------------------------------------------------------------------------
# Runtime stage (compose target: runtime). The whole workspace is copied
# wholesale so pnpm's relative node_modules symlinks stay intact; the worker
# and the controlled release builder also need pnpm + git + the template
# sources at runtime, which rules out a pruned node_modules deploy for now.
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
VOLUME /data
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# ---------------------------------------------------------------------------
# Static web stage (compose target: web). Caddy serves the built builder SPA
# and reverse-proxies /api, /p and /published to the atoms service.
# ---------------------------------------------------------------------------
FROM caddy:2 AS web
COPY --from=build /app/apps/web/dist /srv/web
