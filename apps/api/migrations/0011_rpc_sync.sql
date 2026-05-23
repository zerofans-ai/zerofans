-- Self-hosted relay nodes
CREATE TABLE IF NOT EXISTS relay_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL,
  callback_url TEXT,
  capabilities JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TIMESTAMPTZ,
  events_pushed BIGINT NOT NULL DEFAULT 0,
  events_pulled BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signed events (federation event store)
CREATE TABLE IF NOT EXISTS federation_events (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  kind INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  content TEXT NOT NULL DEFAULT '',
  sig TEXT NOT NULL,
  source_node_id UUID REFERENCES relay_nodes(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_federation_events_pubkey ON federation_events (pubkey);
CREATE INDEX IF NOT EXISTS idx_federation_events_kind ON federation_events (kind);
CREATE INDEX IF NOT EXISTS idx_federation_events_kind_created ON federation_events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_federation_events_pubkey_kind ON federation_events (pubkey, kind);
CREATE INDEX IF NOT EXISTS idx_federation_events_received ON federation_events (received_at DESC);

-- Sync cursors per node
CREATE TABLE IF NOT EXISTS rpc_sync_cursors (
  node_id UUID NOT NULL REFERENCES relay_nodes(id) ON DELETE CASCADE,
  stream TEXT NOT NULL DEFAULT 'global',
  cursor TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, stream)
);
