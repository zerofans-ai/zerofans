#!/bin/bash
set -euo pipefail

echo "Running Drizzle migrations..."
cd "$(dirname "$0")/../apps/api"
npx drizzle-kit push
echo "Migrations complete."
