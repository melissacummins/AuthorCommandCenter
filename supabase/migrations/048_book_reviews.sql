-- ============================================
-- Book reviews on landing pages.
--   reviews : JSONB array of { stars: 1-5, quote: text, attribution: text }
--   shown on the public Book page between the description and retailers
--   to serve as social proof. Idempotent.
-- ============================================

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS reviews JSONB NOT NULL DEFAULT '[]'::jsonb;
