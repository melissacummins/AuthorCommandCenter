-- ============================================
-- Bio page blocks: sections (title + body) and image cards
--   Adds a bio_blocks table that interleaves with bio-enabled
--   short_links by bio_sort_order. Lets the bio page have
--   centered text headings between groups of cards and large
--   clickable image cards in addition to standard link cards.
--
--   Also adds short_links.thumbnail_url for an optional small
--   preview image rendered at the left of a regular link card.
--   When unset, the bio renderer falls back to the OG image
--   already cached for the destination in link_og_cache.
-- Run this in your Supabase SQL Editor.
-- ============================================

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE TABLE IF NOT EXISTS bio_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT,
  body            TEXT,
  image_url       TEXT,
  link_url        TEXT,
  bio_sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bio_blocks DROP CONSTRAINT IF EXISTS bio_blocks_type_check;
ALTER TABLE bio_blocks
  ADD CONSTRAINT bio_blocks_type_check CHECK (type IN ('section', 'image'));

CREATE INDEX IF NOT EXISTS bio_blocks_user_order_idx
  ON bio_blocks(user_id, bio_sort_order);

ALTER TABLE bio_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own bio blocks" ON bio_blocks;
CREATE POLICY "Users read own bio blocks"
ON bio_blocks FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own bio blocks" ON bio_blocks;
CREATE POLICY "Users insert own bio blocks"
ON bio_blocks FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own bio blocks" ON bio_blocks;
CREATE POLICY "Users update own bio blocks"
ON bio_blocks FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own bio blocks" ON bio_blocks;
CREATE POLICY "Users delete own bio blocks"
ON bio_blocks FOR DELETE TO authenticated
USING (auth.uid() = user_id);
