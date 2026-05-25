-- ============================================
-- Featured / pinned bio links.
--   bio_featured links render in a highlighted group at the top of the
--   public bio page (e.g. a launch or preorder). Idempotent.
-- ============================================

ALTER TABLE short_links ADD COLUMN IF NOT EXISTS bio_featured BOOLEAN NOT NULL DEFAULT FALSE;
