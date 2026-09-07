-- Spend counters per UTC window (hour or day) and kind: analysis calls, image generations, covers, login attempts per IP.
-- The queue consumer reserves against them before every gpt-image-2 call, so nothing can run away.
CREATE TABLE IF NOT EXISTS spend (
  window TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (window, kind)
);
-- A job is claimed atomically by the consumer (started_at set once); a duplicate message can no longer generate twice.
ALTER TABLE looks ADD COLUMN started_at INTEGER;
ALTER TABLE heroes ADD COLUMN started_at INTEGER;
ALTER TABLE garments ADD COLUMN studio_started_at INTEGER;
