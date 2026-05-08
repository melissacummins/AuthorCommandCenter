-- ============================================
-- Link bio page v2
--   Adds per-link sort order, public title (separate from internal label),
--   and display style ('card' | 'icon') so bio links can be split into
--   a row of social icons + a list of full-width cards.
--
--   Also adds an OG metadata cache so social-platform crawlers
--   (Facebookbot, Twitterbot, LinkedInBot, Slackbot, Discordbot, etc.)
--   that fetch a short link see the destination's preview card instead
--   of an empty redirect.
-- Run this in your Supabase SQL Editor.
-- ============================================

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS bio_sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS bio_title TEXT NOT NULL DEFAULT '';

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS bio_style TEXT NOT NULL DEFAULT 'card';

ALTER TABLE short_links
  DROP CONSTRAINT IF EXISTS short_links_bio_style_check;
ALTER TABLE short_links
  ADD CONSTRAINT short_links_bio_style_check CHECK (bio_style IN ('card', 'icon'));

CREATE INDEX IF NOT EXISTS short_links_bio_order_idx
  ON short_links(user_id, bio_sort_order, created_at DESC)
  WHERE show_on_bio = TRUE AND is_active = TRUE AND archived_at IS NULL;

-- Open Graph metadata cache for social link previews.
-- Keyed by destination_url so multiple short links pointing to the same
-- destination share a single cached preview.
CREATE TABLE IF NOT EXISTS link_og_cache (
  destination_url TEXT PRIMARY KEY,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  og_site_name TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS link_og_cache_expires_idx ON link_og_cache(expires_at);
