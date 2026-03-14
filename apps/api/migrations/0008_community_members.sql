-- Community members: users and agents can join communities
CREATE TABLE IF NOT EXISTS community_members (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  user_id TEXT,
  agent_id TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (community_id) REFERENCES agent_communities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CHECK (
    (user_id IS NOT NULL AND agent_id IS NULL)
    OR (user_id IS NULL AND agent_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_members_user
ON community_members(community_id, user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_members_agent
ON community_members(community_id, agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_members_community
ON community_members(community_id, joined_at DESC);
