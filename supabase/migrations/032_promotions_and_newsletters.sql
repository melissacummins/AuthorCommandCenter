-- ============================================
-- Phase 4: Promotions + Newsletter events
--   Two new event-bearing tables that feed the future Timeline view
--   alongside book_daily_metrics, arc_reader_books, and catalog
--   launches. Both tables key on book_id so the Timeline can join
--   directly without title-string lookups.
--
--   Promotions are per-book by design: a BookBub Featured Deal, a
--   free run, an AMS bump — even when the same campaign covers
--   several titles, ROI tracking is much easier when each row is
--   one book's slice of the spend and the units moved.
--
--   Newsletter events are many-to-many with books via
--   newsletter_event_books so a single Klaviyo campaign that mentions
--   three new releases produces one event row and three attribution
--   rows. klaviyo_campaign_id is the foreign reference for the
--   webhook handler in a later PR to find and update the row.
-- ============================================

CREATE TABLE IF NOT EXISTS promotions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id       UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Curated list rather than free-text so the Timeline can color-code.
  -- 'other' is the escape hatch — anything new becomes a fixed kind
  -- once it's common enough to justify the special-casing.
  kind          TEXT NOT NULL DEFAULT 'other'
                  CHECK (kind IN (
                    'bookbub_featured', 'bookbub_deal', 'freebooksy',
                    'fussy_librarian', 'ereader_news_today',
                    'free_run', 'kindle_countdown',
                    'newsletter_swap', 'amazon_ad', 'facebook_ad',
                    'tiktok_ad', 'group_promo', 'other'
                  )),

  -- User-friendly label that shows in the Timeline event log.
  name          TEXT NOT NULL,

  -- Single-day promos use the same value for both. Tooling can group
  -- multi-day promos into one event with a duration.
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,

  -- Money in, money out. Both nullable because some promos are free
  -- (e.g. a free swap) or we don't know the revenue yet.
  cost          NUMERIC(12,2),
  revenue       NUMERIC(12,2),

  -- Volume attribution. free_downloads is meaningful for free runs;
  -- units_sold for everything else. Both columns so each promo kind
  -- has the right number on the row.
  free_downloads INTEGER,
  units_sold     INTEGER,

  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS promotions_user_idx       ON promotions (user_id);
CREATE INDEX IF NOT EXISTS promotions_book_idx       ON promotions (book_id);
CREATE INDEX IF NOT EXISTS promotions_user_start_idx ON promotions (user_id, starts_on DESC);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promotions: owner read"   ON promotions;
DROP POLICY IF EXISTS "promotions: owner insert" ON promotions;
DROP POLICY IF EXISTS "promotions: owner update" ON promotions;
DROP POLICY IF EXISTS "promotions: owner delete" ON promotions;

CREATE POLICY "promotions: owner read"   ON promotions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "promotions: owner insert" ON promotions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "promotions: owner update" ON promotions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "promotions: owner delete" ON promotions FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS newsletter_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Klaviyo's id when the campaign came from there. Manual entries
  -- (Substack, Mailchimp, anything else) leave this NULL.
  klaviyo_campaign_id   TEXT,

  subject               TEXT NOT NULL,
  sent_at               TIMESTAMPTZ NOT NULL,

  -- Performance counts captured at the time of attribution / refresh.
  -- A later background job (or manual refresh) can re-pull from
  -- Klaviyo and update these in place.
  sent_count            INTEGER NOT NULL DEFAULT 0,
  open_count            INTEGER NOT NULL DEFAULT 0,
  click_count           INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count     INTEGER NOT NULL DEFAULT 0,
  metrics_refreshed_at  TIMESTAMPTZ,

  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A given Klaviyo campaign can only be logged once per user — the
-- attribution is fixed by campaign id, not by send.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_events_user_campaign_key
  ON newsletter_events (user_id, klaviyo_campaign_id)
  WHERE klaviyo_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS newsletter_events_user_sent_idx
  ON newsletter_events (user_id, sent_at DESC);

ALTER TABLE newsletter_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_events: owner read"   ON newsletter_events;
DROP POLICY IF EXISTS "newsletter_events: owner insert" ON newsletter_events;
DROP POLICY IF EXISTS "newsletter_events: owner update" ON newsletter_events;
DROP POLICY IF EXISTS "newsletter_events: owner delete" ON newsletter_events;

CREATE POLICY "newsletter_events: owner read"   ON newsletter_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "newsletter_events: owner insert" ON newsletter_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "newsletter_events: owner update" ON newsletter_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "newsletter_events: owner delete" ON newsletter_events FOR DELETE USING (auth.uid() = user_id);


-- Book attribution per newsletter event. A campaign that mentions
-- three releases produces three rows here so the Timeline shows up
-- on each of the linked books.
CREATE TABLE IF NOT EXISTS newsletter_event_books (
  newsletter_event_id   UUID NOT NULL REFERENCES newsletter_events(id) ON DELETE CASCADE,
  book_id               UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (newsletter_event_id, book_id)
);

CREATE INDEX IF NOT EXISTS newsletter_event_books_book_idx ON newsletter_event_books (book_id);

ALTER TABLE newsletter_event_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_event_books: owner read"   ON newsletter_event_books;
DROP POLICY IF EXISTS "newsletter_event_books: owner insert" ON newsletter_event_books;
DROP POLICY IF EXISTS "newsletter_event_books: owner update" ON newsletter_event_books;
DROP POLICY IF EXISTS "newsletter_event_books: owner delete" ON newsletter_event_books;

CREATE POLICY "newsletter_event_books: owner read"   ON newsletter_event_books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "newsletter_event_books: owner insert" ON newsletter_event_books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "newsletter_event_books: owner update" ON newsletter_event_books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "newsletter_event_books: owner delete" ON newsletter_event_books FOR DELETE USING (auth.uid() = user_id);
