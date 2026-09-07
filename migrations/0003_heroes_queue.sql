CREATE TABLE IF NOT EXISTS heroes (
  id TEXT PRIMARY KEY,
  r2_key TEXT,
  garment_ids TEXT NOT NULL,
  style TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
