-- Wardrobe: pieces you already own, the analysis that fills the form, and the pairing a look was generated with.
ALTER TABLE garments ADD COLUMN owned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE garments ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE garments ADD COLUMN colors TEXT;
ALTER TABLE garments ADD COLUMN description TEXT;
ALTER TABLE garments ADD COLUMN covers TEXT;
ALTER TABLE garments ADD COLUMN missing TEXT;
ALTER TABLE garments ADD COLUMN studio_key TEXT;
ALTER TABLE garments ADD COLUMN studio_status TEXT;
ALTER TABLE looks ADD COLUMN pairing TEXT;
CREATE INDEX IF NOT EXISTS garments_owned ON garments(owned, draft, created_at);
