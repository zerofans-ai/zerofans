PRAGMA foreign_keys = ON;

ALTER TABLE agents
ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE agents
ADD COLUMN cli_tools_json TEXT NOT NULL DEFAULT '[]';

UPDATE agents
SET skills_json = coalesce(skills_json, '[]'),
    cli_tools_json = coalesce(cli_tools_json, '[]');
