-- ============================================
-- Catalog: per-book records
-- ============================================

CREATE TABLE IF NOT EXISTS books (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  title               TEXT NOT NULL,
  subtitle            TEXT,
  series              TEXT,
  series_position     INTEGER,

  -- Status & dates
  status              TEXT NOT NULL DEFAULT 'idea'
                        CHECK (status IN ('idea','drafting','editing','pre_order','published','paused')),
  publish_date        DATE,
  pre_order_date      DATE,
  manuscript_due_date DATE,

  -- Pricing
  ebook_price         NUMERIC(10,2),
  paperback_price     NUMERIC(10,2),
  hardcover_price     NUMERIC(10,2),
  audiobook_price     NUMERIC(10,2),

  -- Copy
  blurb               TEXT,
  content_warnings    TEXT,
  kinks               TEXT,
  tropes              TEXT[] NOT NULL DEFAULT '{}',

  -- Production
  page_count          INTEGER,
  word_count          INTEGER,
  target_word_count   INTEGER,
  current_chapter     TEXT,

  -- Identifiers
  asin                TEXT,
  isbn_ebook          TEXT,
  isbn_paperback      TEXT,
  isbn_audiobook      TEXT,
  isbn_hardcover      TEXT,

  -- Discovery
  amazon_keywords     TEXT[] NOT NULL DEFAULT '{}',
  keywords            TEXT[] NOT NULL DEFAULT '{}',
  bisac_categories    TEXT[] NOT NULL DEFAULT '{}',

  -- Reviews: array of { quote, source, rating }
  reviews             JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Assets
  cover_url           TEXT,

  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS books_user_idx ON books(user_id);
CREATE INDEX IF NOT EXISTS books_user_series_idx ON books(user_id, series, series_position);
CREATE INDEX IF NOT EXISTS books_user_status_idx ON books(user_id, status);

ALTER TABLE books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own books" ON books;
CREATE POLICY "Users read own books"
ON books FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own books" ON books;
CREATE POLICY "Users insert own books"
ON books FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own books" ON books;
CREATE POLICY "Users update own books"
ON books FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own books" ON books;
CREATE POLICY "Users delete own books"
ON books FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION books_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS books_updated_at ON books;
CREATE TRIGGER books_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION books_set_updated_at();
