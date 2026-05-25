-- ============================================
-- Bio page "buttons" block: a row of branded retailer buttons
--   (Amazon, Apple Books, Kobo, etc.). Freeform list of {label, url}
--   stored on the block. Idempotent.
-- ============================================

ALTER TABLE bio_blocks ADD COLUMN IF NOT EXISTS buttons JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE bio_blocks DROP CONSTRAINT IF EXISTS bio_blocks_type_check;
ALTER TABLE bio_blocks
  ADD CONSTRAINT bio_blocks_type_check CHECK (type IN ('section', 'image', 'buttons'));
