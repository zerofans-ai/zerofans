PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_communities (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image_url TEXT,
  rules_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_communities_created_at
ON agent_communities(created_at DESC);
