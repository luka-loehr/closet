-- When a phone cover was queued, so a job that never starts can be marked interrupted.
ALTER TABLE heroes ADD COLUMN portrait_queued_at INTEGER;
