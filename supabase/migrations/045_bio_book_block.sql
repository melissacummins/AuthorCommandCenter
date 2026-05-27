-- ============================================
-- Bio page "book" block: embeds an existing landing page as an inline,
--   expandable card on the bio page (cover + title; tap to reveal the
--   blurb + retailer buttons without leaving the page). References a
--   landing_pages row so the book is built once and reused.
-- Idempotent.
-- ============================================

ALTER TABLE bio_blocks
  ADD COLUMN IF NOT EXISTS landing_page_id UUID REFERENCES landing_pages(id) ON DELETE CASCADE;

ALTER TABLE bio_blocks DROP CONSTRAINT IF EXISTS bio_blocks_type_check;
ALTER TABLE bio_blocks
  ADD CONSTRAINT bio_blocks_type_check CHECK (type IN ('section', 'image', 'buttons', 'email', 'book'));
