#!/bin/bash
# Runs the API server and the agent worker in one container. Either process
# dying exits the container so Docker's restart policy brings the stack back.
set -e

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
