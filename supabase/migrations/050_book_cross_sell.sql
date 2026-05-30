-- ============================================
-- Cross-sell block on Book landing pages.
--   series_page_id    : optional FK to a series_page. When set, the public
--                       Book page renders the other books from that series
--                       below the retailers.
--   cross_sell_label  : which heading to use over the cross-sell block.
--                       'series' -> "Read the complete series"
--                       'world'  -> "More standalones in this world"
--                       'more'   -> "More books like this"
--                       'none'   -> hide the block even if a series is set
--   Idempotent.
-- ============================================

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS series_page_id UUID
  REFERENCES series_pages(id) ON DELETE SET NULL;

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS cross_sell_label TEXT NOT NULL DEFAULT 'series';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'landing_pages_cross_sell_label_check'
  ) THEN
    ALTER TABLE landing_pages
      ADD CONSTRAINT landing_pages_cross_sell_label_check
      CHECK (cross_sell_label IN ('series', 'world', 'more', 'none'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS landing_pages_series_page_idx
  ON landing_pages(series_page_id)
  WHERE series_page_id IS NOT NULL;
