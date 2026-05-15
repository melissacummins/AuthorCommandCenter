-- Additional social / review profile columns for ARC readers.
-- Idempotent: safe to re-run against the preview branch database.

ALTER TABLE arc_readers ADD COLUMN IF NOT EXISTS fb_profile_url       TEXT;
ALTER TABLE arc_readers ADD COLUMN IF NOT EXISTS threads_profile_url  TEXT;
ALTER TABLE arc_readers ADD COLUMN IF NOT EXISTS amazon_reviewer_url  TEXT;
