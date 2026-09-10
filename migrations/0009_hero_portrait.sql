-- Phone covers: a portrait (9:16) version of each campaign cover, generated on request for the iOS app.
ALTER TABLE heroes ADD COLUMN portrait_key TEXT;
ALTER TABLE heroes ADD COLUMN portrait_status TEXT;
ALTER TABLE heroes ADD COLUMN portrait_error TEXT;
ALTER TABLE heroes ADD COLUMN portrait_started_at INTEGER;
