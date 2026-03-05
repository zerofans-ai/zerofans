PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_moderation (
  media_key TEXT PRIMARY KEY,
  media_url TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'review')),
  reason TEXT,
  blocked_categories_json TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_media_moderation_status_updated
ON media_moderation(status, updated_at DESC);
