#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

API_PORT="${DEV_API_PORT:-8787}"
WEB_PORT="${DEV_WEB_PORT:-5173}"
WEB_HOST="${DEV_WEB_HOST:-0.0.0.0}"
WEB_API_URL="${DEV_WEB_API_URL:-http://127.0.0.1:${API_PORT}}"

AUTO_RESTART="${DEV_AUTO_RESTART:-1}"
MAX_RESTARTS="${DEV_MAX_RESTARTS:-4}"
RESTART_DELAY_SECONDS="${DEV_RESTART_DELAY_SECONDS:-2}"
ALLOW_REMOTE_API="${DEV_ALLOW_REMOTE_API:-0}"

API_SUPERVISOR_PID=""
WEB_SUPERVISOR_PID=""

log() {
  printf '[dev] %s\n' "$*"
}

warn() {
  printf '[dev] warning: %s\n' "$*" >&2
}

fail() {
  printf '[dev] error: %s\n' "$*" >&2
  exit 1
}

read_env_value() {
  local file="$1"
  local key="$2"
  local value

  value="$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d '=' -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

is_port_busy() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi

  fail "Port availability checks require either lsof or nc."
}

assert_port_available() {
  local port="$1"
  local label="$2"
  local override_var="$3"

  if is_port_busy "$port"; then
    fail "${label} port ${port} is already in use. Stop the existing process or override with ${override_var}."
  fi
}

run_preflight() {
  local api_env_file="${ROOT_DIR}/apps/api/.dev.vars"
  local jwt_secret

  [[ -f "$api_env_file" ]] || fail "Missing apps/api/.dev.vars. Run: cp apps/api/.dev.vars.example apps/api/.dev.vars"

  jwt_secret="$(read_env_value "$api_env_file" "JWT_SECRET")"
  if [[ -z "$jwt_secret" || "$jwt_secret" == "replace-with-long-random-secret" ]]; then
    fail "apps/api/.dev.vars JWT_SECRET must be set to a real secret."
  fi

  case "$WEB_API_URL" in
    "http://127.0.0.1:${API_PORT}"|"http://localhost:${API_PORT}")
      ;;
    *)
      if [[ "$ALLOW_REMOTE_API" != "1" ]]; then
        fail "DEV_WEB_API_URL is '${WEB_API_URL}'. Use local API URL or set DEV_ALLOW_REMOTE_API=1."
      fi
      warn "Using non-local DEV_WEB_API_URL: ${WEB_API_URL}"
      ;;
  esac

  assert_port_available "$API_PORT" "api" "DEV_API_PORT"
  assert_port_available "$WEB_PORT" "web" "DEV_WEB_PORT"
}

prefix_stream() {
  local label="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

run_with_supervision() {
  local label="$1"
  shift
  local restart_count=0
  local exit_code=0

  while true; do
    set +e
    "$@" 2>&1 | prefix_stream "$label"
    exit_code=${PIPESTATUS[0]}
    set -e

    if [[ "$exit_code" -eq 0 ]]; then
      return 0
    fi

    if [[ "$AUTO_RESTART" != "1" || "$restart_count" -ge "$MAX_RESTARTS" ]]; then
      printf '[%s] exited with code %s\n' "$label" "$exit_code" >&2
      return "$exit_code"
    fi

    restart_count=$((restart_count + 1))
    printf '[%s] exited with code %s; restarting (%s/%s) in %ss\n' \
      "$label" "$exit_code" "$restart_count" "$MAX_RESTARTS" "$RESTART_DELAY_SECONDS" >&2
    sleep "$RESTART_DELAY_SECONDS"
  done
}

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "$API_SUPERVISOR_PID" ]] && kill -0 "$API_SUPERVISOR_PID" 2>/dev/null; then
    kill "$API_SUPERVISOR_PID" 2>/dev/null || true
  fi

  if [[ -n "$WEB_SUPERVISOR_PID" ]] && kill -0 "$WEB_SUPERVISOR_PID" 2>/dev/null; then
    kill "$WEB_SUPERVISOR_PID" 2>/dev/null || true
  fi

  if [[ -n "$API_SUPERVISOR_PID" ]]; then
    wait "$API_SUPERVISOR_PID" 2>/dev/null || true
  fi

  if [[ -n "$WEB_SUPERVISOR_PID" ]]; then
    wait "$WEB_SUPERVISOR_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

run_preflight

log "Starting local stack with API :${API_PORT} and web :${WEB_PORT}"

run_with_supervision "api" \
  bun run --cwd "${ROOT_DIR}/apps/api" dev -- --port "${API_PORT}" &
API_SUPERVISOR_PID=$!

run_with_supervision "web" \
  env VITE_API_URL="${WEB_API_URL}" \
  bun run --cwd "${ROOT_DIR}/apps/web" dev -- --host "${WEB_HOST}" --port "${WEB_PORT}" --strictPort &
WEB_SUPERVISOR_PID=$!

while true; do
  if ! kill -0 "$API_SUPERVISOR_PID" 2>/dev/null; then
    set +e
    wait "$API_SUPERVISOR_PID"
    exit_code=$?
    set -e
    exit "$exit_code"
  fi

  if ! kill -0 "$WEB_SUPERVISOR_PID" 2>/dev/null; then
    set +e
    wait "$WEB_SUPERVISOR_PID"
    exit_code=$?
    set -e
    exit "$exit_code"
  fi

  sleep 1
done
