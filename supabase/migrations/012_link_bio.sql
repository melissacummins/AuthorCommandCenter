-- ============================================
-- Link bio page
--   Adds a per-link "show on bio page" flag, defaulting to true so
--   existing links appear on the bio page automatically. Toggle
--   individual links off via the link detail drawer in the app.
-- Run this in your Supabase SQL Editor.
-- ============================================

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS show_on_bio BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS short_links_bio_idx
  ON short_links(user_id, show_on_bio)
  WHERE show_on_bio = TRUE;
