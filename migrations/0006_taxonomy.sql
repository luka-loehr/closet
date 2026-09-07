-- Map the coarse first-generation categories onto the fixed taxonomy (src/taxonomy.ts).
UPDATE garments SET category = 't-shirt' WHERE category = 'tee';
UPDATE garments SET category = 'trousers' WHERE category = 'pants';
