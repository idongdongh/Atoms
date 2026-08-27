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
# Seed a pnpm store with the generated-app template's dependencies. The store
# is copied to the data volume on first boot, so every project's preview
# install hard-links locally instead of downloading from npm. The template
# directory itself must stay clean (node_modules is a reserved entry for
# workspace instantiation).
RUN pnpm --dir templates/react-vite install --ignore-workspace --frozen-lockfile --store-dir /app/.pnpm-seed \
  && rm -rf templates/react-vite/node_modules

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
