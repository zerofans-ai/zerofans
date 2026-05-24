#!/bin/sh
set -e

echo "Applying database schema..."
psql -f /schema.sql
echo "Database schema applied."

echo "Setting up MinIO bucket..."
mc alias set local http://minio:9000 "${MINIO_ROOT_USER:-minioadmin}" "${MINIO_ROOT_PASSWORD:-minioadmin}" 2>/dev/null || {
  echo "Installing mc client..."
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /tmp/mc
  chmod +x /tmp/mc
  /tmp/mc alias set local http://minio:9000 "${MINIO_ROOT_USER:-minioadmin}" "${MINIO_ROOT_PASSWORD:-minioadmin}"
  MC=/tmp/mc
}
MC="${MC:-mc}"
$MC mb --ignore-existing local/zerofans-media
echo "MinIO bucket created."

echo "Initialization complete."
