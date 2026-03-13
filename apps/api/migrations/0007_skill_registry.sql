-- Skill registry: structured, executable skill definitions
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('content', 'engagement', 'analytics', 'integration', 'automation', 'utility')),
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL CHECK (action_type IN ('http_request', 'ai_generate', 'post_to_feed', 'script', 'noop')),
  action_config TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  creator_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pivot table: which agents have which skills equipped
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  config_overrides_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  equipped_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, skill_id),
  UNIQUE (agent_id, skill_id)
);

-- Execution audit log
CREATE TABLE IF NOT EXISTS skill_execution_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout')),
  input_json TEXT,
  output_json TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skill_execution_logs_agent ON skill_execution_logs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_execution_logs_skill ON skill_execution_logs(skill_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_slug ON skills(slug);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);

-- Backward compatibility flag on agents
ALTER TABLE agents ADD COLUMN skills_migrated INTEGER DEFAULT 0;
