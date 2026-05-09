-- ============================================
-- Bot detection v2: catch automated traffic that pretends to be a browser
--
--   The original is_bot regex only matches user-agents that self-identify
--   ("facebookexternalhit", "Slackbot", "crawler", etc.). It misses
--   sneakier traffic: Facebook's review/scanning infrastructure spoofs
--   real Chrome UAs from their data centers (Prineville, Altoona, Fort
--   Worth), AWS-hosted security scanners use Windows Chrome UAs, and
--   vulnerability scanners often use outdated browser versions.
--
--   This migration:
--     1. Adds non_bot_click_count column on short_links so the link list
--        and analytics can show "actual reader" numbers without filtering
--        the entire link_clicks table on every render.
--     2. Reclassifies existing rows that came from known small-town data
--        centers OR outdated Chrome versions (<100) as bots.
--     3. Backfills non_bot_click_count from the reclassified data.
--     4. Recreates the click counter trigger to maintain both counts.
-- Run this in your Supabase SQL Editor.
-- ============================================

ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS non_bot_click_count INTEGER NOT NULL DEFAULT 0;

-- Reclassify existing clicks
UPDATE link_clicks
SET is_bot = TRUE
WHERE is_bot = FALSE
  AND (
    -- Small-town cities that are essentially 100% data center traffic.
    -- Conservative list — excludes larger cities like Fort Worth and
    -- Mountain View where real residents could plausibly visit.
    LOWER(COALESCE(city, '')) IN (
      'prineville',     -- OR, FB/Apple DC (~10k pop)
      'boardman',       -- OR, AWS DC (~4k pop)
      'the dalles',     -- OR, Google DC (~16k pop)
      'forest city',    -- NC, FB DC (~7k pop)
      'lenoir',         -- NC, Google DC (~17k pop)
      'quincy',         -- WA, Microsoft DC (~7k pop)
      'altoona',        -- IA, FB DC (~14k pop)
      'lulea',          -- Sweden, FB DC
      'eemshaven',      -- Netherlands, Google DC
      'clonee',         -- Ireland, FB DC
      'henderson'       -- NV, various DCs
    )
    OR
    -- Chrome versions <100 are essentially all automated scanners; real
    -- users keep up to date and Chrome is at 130+ in 2026.
    user_agent ~ 'Chrome/[0-9][0-9]?\.[0-9]'
  );

-- Backfill non_bot_click_count from current click data
UPDATE short_links
SET non_bot_click_count = COALESCE((
  SELECT COUNT(*) FROM link_clicks
  WHERE link_clicks.link_id = short_links.id
    AND link_clicks.is_bot = FALSE
), 0);

-- Maintain both counters on insert
CREATE OR REPLACE FUNCTION update_link_click_counts() RETURNS TRIGGER AS $$
BEGIN
  UPDATE short_links
  SET
    click_count = click_count + 1,
    non_bot_click_count = non_bot_click_count + (CASE WHEN NEW.is_bot THEN 0 ELSE 1 END),
    last_clicked_at = NEW.clicked_at
  WHERE id = NEW.link_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop any older variants of the click-counter trigger before installing
-- the new one so we don't end up double-incrementing.
DROP TRIGGER IF EXISTS update_link_click_counts ON link_clicks;
DROP TRIGGER IF EXISTS increment_link_click ON link_clicks;
DROP TRIGGER IF EXISTS increment_link_clicks ON link_clicks;
DROP TRIGGER IF EXISTS link_clicks_increment_count ON link_clicks;

CREATE TRIGGER update_link_click_counts
AFTER INSERT ON link_clicks
FOR EACH ROW EXECUTE FUNCTION update_link_click_counts();
