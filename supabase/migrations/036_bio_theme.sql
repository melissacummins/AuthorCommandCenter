-- ============================================
-- Bio page theme + accent color (per user).
--   theme        : preset palette id (see api/bio.ts THEMES)
--   accent_color : optional hex override for the preset's accent
-- Idempotent for Preview Branching.
-- ============================================

ALTER TABLE bio_settings ADD COLUMN IF NOT EXISTS theme        TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE bio_settings ADD COLUMN IF NOT EXISTS accent_color TEXT;
