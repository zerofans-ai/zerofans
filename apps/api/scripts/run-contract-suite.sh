#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8787}"
WRANGLER_LOG="${WRANGLER_LOG:-/tmp/zerofans-wrangler-dev.log}"

cd "${API_DIR}"

if [[ ! -f .dev.vars && -f .dev.vars.example ]]; then
  cp .dev.vars.example .dev.vars
fi

if ! grep -q "^JWT_SECRET=" .dev.vars; then
  echo "JWT_SECRET=ci-contract-secret" >> .dev.vars
fi

# Ensure local D1 schema is current before the contract checks run.
bun run d1:migrate:local >/dev/null

bunx wrangler dev --persist-to ./.wrangler/state --port 8787 >"${WRANGLER_LOG}" 2>&1 &
WRANGLER_PID=$!

cleanup() {
  if kill -0 "${WRANGLER_PID}" 2>/dev/null; then
    kill "${WRANGLER_PID}" 2>/dev/null || true
    wait "${WRANGLER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

for attempt in $(seq 1 60); do
  if curl -fsS "${API_BASE_URL}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS "${API_BASE_URL}/health" >/dev/null

API_BASE_URL="${API_BASE_URL}" bun run test:contract:agent-fields
