-- ============================================
-- Per-spot book text + a separate headline.
--   headline        : a short hook for a book (in addition to description)
--   page_text_mode  : which text the standalone Book page shows
--                     ('headline' | 'description' | 'custom' | 'none')
--   page_text_custom: custom text for the Book page when mode = 'custom'
--   bio_blocks.text_mode  : same choice for a bio "book" block (custom text
--                           reuses the existing body column)
--   series_pages.card_text_mode : text shown on each series card
--                                  ('headline' | 'description' | 'none')
-- Defaults preserve current behavior (full description everywhere).
-- Idempotent.
-- ============================================

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS headline         TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS page_text_mode   TEXT NOT NULL DEFAULT 'description';
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS page_text_custom TEXT;

ALTER TABLE bio_blocks ADD COLUMN IF NOT EXISTS text_mode TEXT;

ALTER TABLE series_pages ADD COLUMN IF NOT EXISTS card_text_mode TEXT NOT NULL DEFAULT 'description';
