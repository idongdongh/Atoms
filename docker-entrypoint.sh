#!/bin/bash
# Runs the API server and the agent worker in one container. Either process
# dying exits the container so Docker's restart policy brings the stack back.
set -e

# First boot: materialize the image's seeded pnpm store onto the data volume
# so project installs hard-link locally and survive container rebuilds.
if [ ! -d /data/.pnpm-store ] && [ -d /app/.pnpm-seed ]; then
  cp -a /app/.pnpm-seed /data/.pnpm-store
fi

node apps/api/dist/server.js &
API_PID=$!
node apps/agent-worker/dist/index.js &
WORKER_PID=$!

term() {
  kill "$API_PID" "$WORKER_PID" 2>/dev/null || true
}
trap term TERM INT

wait -n "$API_PID" "$WORKER_PID"
STATUS=$?
term
exit $STATUS
