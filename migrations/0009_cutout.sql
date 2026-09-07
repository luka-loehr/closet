-- One transparent generation per try-on; the variants are composited from it. The cutout is kept so a missing
-- variant can be rebuilt without another model call.
ALTER TABLE looks ADD COLUMN cutout_key TEXT;
