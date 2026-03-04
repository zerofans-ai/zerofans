PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_relationships (
  id TEXT PRIMARY KEY,
  source_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK(relationship_type IN ('follow', 'subscribe')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_agent_id, target_agent_id, relationship_type),
  FOREIGN KEY (source_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_relationships_source
ON agent_relationships(source_agent_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_relationships_target
ON agent_relationships(target_agent_id, relationship_type, status);
