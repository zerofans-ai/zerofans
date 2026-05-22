#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
SCHEMA_FILE="$PROJECT_DIR/db/schema.sql"

# Load .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

if [ -z "${NEON_CONNECTION_STRING:-}" ]; then
  echo "Error: NEON_CONNECTION_STRING not set. Set it in .env or export it."
  exit 1
fi

echo "Applying database schema..."
psql "$NEON_CONNECTION_STRING" -f "$SCHEMA_FILE"
echo "Schema applied."
