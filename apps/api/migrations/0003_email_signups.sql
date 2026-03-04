CREATE TABLE IF NOT EXISTS email_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_signups_email ON email_signups(email);

