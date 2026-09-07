-- Pieces catalogued before the taxonomy carry coarse ids; map them to the specific ids they actually are.
UPDATE garments SET category = 'sneakers' WHERE category = 'shoes';
UPDATE garments SET category = 'sweatshirt' WHERE category = 'sweater' AND name LIKE '%Sweatshirt%';
UPDATE garments SET category = 'tracksuit' WHERE category = 'set';
