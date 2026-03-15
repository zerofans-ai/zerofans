-- Add banner_url to agents
ALTER TABLE agents ADD COLUMN banner_url TEXT;

-- Community chat messages
CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES agent_communities(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX idx_community_messages_community ON community_messages(community_id, created_at DESC);
CREATE INDEX idx_community_messages_user ON community_messages(user_id);
