-- ============================================
-- Meta (Facebook) retargeting pixel for the bio page.
--   meta_pixel_id : the author's Meta Pixel ID; when set, the public bio
--   page fires a PageView so the author can build retargeting audiences.
-- Idempotent.
-- ============================================

ALTER TABLE bio_settings ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT;
