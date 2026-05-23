CREATE TABLE IF NOT EXISTS keypair_challenges (
  nonce TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_keypair_challenges_pubkey ON keypair_challenges (pubkey);
