#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
ENV_FILE="$PROJECT_DIR/.env"
EXAMPLE_FILE="$PROJECT_DIR/.env.example"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "  ZeroFans — Self-Host Setup"
echo "  ==========================="
echo ""

# Step 1: Copy .env.example
if [ -f "$ENV_FILE" ]; then
  echo -e "${CYAN}[1/5]${NC} .env already exists — skipping copy"
else
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo -e "${GREEN}[1/5]${NC} Created .env from .env.example"
fi

# Helper to generate secret
gen_secret() {
  openssl rand -hex 32
}

# Helper to prompt or auto-generate
prompt_secret() {
  local varname="$1"
  local label="$2"
  local current
  current=$(grep "^${varname}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)

  if [ -n "$current" ] && [ "$current" != "change-me-to-a-random-secret" ] && [ "$current" != "change-me-to-a-random-signing-secret" ] && [ "$current" != "zerofans" ]; then
    echo -e "  ${varname} already set — keeping current value"
    return
  fi

  local generated
  generated=$(gen_secret)

  if [ -t 0 ]; then
    echo -ne "  ${label} [press Enter to auto-generate]: "
    read -r input
    if [ -n "$input" ]; then
      generated="$input"
    fi
  fi

  # Update .env
  if grep -q "^${varname}=" "$ENV_FILE"; then
    sed -i.bak "s|^${varname}=.*|${varname}=${generated}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "${varname}=${generated}" >> "$ENV_FILE"
  fi
  echo -e "  ${GREEN}Set ${varname}${NC}"
}

# Step 2-4: Generate secrets
echo ""
echo -e "${CYAN}[2/5]${NC} JWT_SECRET"
prompt_secret "JWT_SECRET" "JWT secret"

echo ""
echo -e "${CYAN}[3/5]${NC} SIGNING_SECRET"
prompt_secret "SIGNING_SECRET" "Signing secret"

echo ""
echo -e "${CYAN}[4/5]${NC} POSTGRES_PASSWORD"
prompt_secret "POSTGRES_PASSWORD" "PostgreSQL password"
# Also update the connection string
PGPASS=$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)
if grep -q "^NEON_CONNECTION_STRING=" "$ENV_FILE"; then
  sed -i.bak "s|^NEON_CONNECTION_STRING=.*|NEON_CONNECTION_STRING=postgresql://zerofans:${PGPASS}@postgres:5432/zerofans|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
fi

# Step 5: Optional relay registration
echo ""
echo -e "${CYAN}[5/5]${NC} Relay registration (optional)"
if [ -t 0 ]; then
  echo -ne "  Register with a central relay? (y/N): "
  read -r register
  if [ "$register" = "y" ] || [ "$register" = "Y" ]; then
    echo -ne "  Relay URL (e.g. https://api.zerofans.ai): "
    read -r relay_url
    if [ -n "$relay_url" ]; then
      echo -ne "  Node name: "
      read -r node_name
      node_name="${node_name:-self-host-$(date +%s)}"

      echo "  Registering with ${relay_url}..."
      result=$(curl -fsSL -X POST "${relay_url}/rpc/trpc/sync.register" \
        -H "content-type: application/json" \
        -d "{\"name\":\"${node_name}\"}" 2>&1 || true)

      if echo "$result" | grep -q "apiKey"; then
        api_key=$(echo "$result" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)
        node_id=$(echo "$result" | grep -o '"nodeId":"[^"]*"' | cut -d'"' -f4)
        echo -e "  ${GREEN}Registered!${NC} Node ID: ${node_id}"
        echo "  API Key: ${api_key}"
        echo ""
        echo "  RELAY_API_KEY=${api_key}" >> "$ENV_FILE"
        echo "  RELAY_NODE_ID=${node_id}" >> "$ENV_FILE"
        echo "  Added RELAY_API_KEY and RELAY_NODE_ID to .env"
      else
        echo "  Registration failed. You can register manually later."
      fi
    fi
  else
    echo "  Skipped. You can register later with the SyncClient."
  fi
else
  echo "  Skipped (non-interactive). Register later with the SyncClient."
fi

# Done
echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "  Next steps:"
echo "    docker compose -f docker-compose.self-host.yml up"
echo ""
echo "  Then check:"
echo "    curl http://localhost:8787/health"
echo ""
