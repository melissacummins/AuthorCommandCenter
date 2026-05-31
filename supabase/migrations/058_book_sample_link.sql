-- ============================================
-- "Read a sample" link on Book landing pages.
--   sample_url   : the URL to the sample / chapter one. NULL = no sample.
--   sample_label : button text. Default "Read a sample" but the author
--                  can rename to "Read chapter one", etc. Stored separately
--                  so renaming doesn't require re-saving the URL.
--   Renders as a pill below the retailer buttons. Idempotent.
-- ============================================

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS sample_url TEXT;
ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS sample_label TEXT NOT NULL DEFAULT 'Read a sample';
