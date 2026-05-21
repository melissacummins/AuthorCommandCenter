-- ============================================
-- Book Tracker
--   Per-book development cost tracking with quarterly profit updates and
--   bundle grouping (translations, box sets). Books move from 'active' to
--   'paid_off' when cumulative profit clears dev cost.
--
--   cumulative_profit / payoff_date / payoff_quarter / months_to_payoff
--   are denormalized fields recomputed by the app layer on every
--   quarterly_updates change. We don't use DB triggers because the data
--   is tiny (< 200 books) and the recompute is cheap in JS.
--
--   tracked_books.legacy_id preserves the epoch-ms ids from the old
--   Firebase export so re-imports are idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS tracked_books (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  legacy_id           BIGINT,

  title               TEXT NOT NULL,
  launch_date         DATE,

  dev_cost            NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- [{category: 'Cover Design'|'Editing'|'Formatting'|'Other'|..., amount: number}]
  cost_breakdown      JSONB NOT NULL DEFAULT '[]'::jsonb,

  cumulative_profit   NUMERIC(14,2) NOT NULL DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paid_off')),

  payoff_date         DATE,
  payoff_quarter      TEXT,
  months_to_payoff    INTEGER,

  catalog_book_id     UUID REFERENCES books(id) ON DELETE SET NULL,
  klaviyo_list_id     TEXT,
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tracked_books_user_legacy_id_key
  ON tracked_books (user_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tracked_books_user_status_idx
  ON tracked_books (user_id, status);

ALTER TABLE tracked_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracked_books: owner read"   ON tracked_books;
DROP POLICY IF EXISTS "tracked_books: owner insert" ON tracked_books;
DROP POLICY IF EXISTS "tracked_books: owner update" ON tracked_books;
DROP POLICY IF EXISTS "tracked_books: owner delete" ON tracked_books;

CREATE POLICY "tracked_books: owner read"   ON tracked_books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tracked_books: owner insert" ON tracked_books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tracked_books: owner update" ON tracked_books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tracked_books: owner delete" ON tracked_books FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS quarterly_updates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tracked_book_id     UUID NOT NULL REFERENCES tracked_books(id) ON DELETE CASCADE,

  -- Preserve the user's original label (e.g. "Q4 2024" or "12/31/2024")
  quarter_label       TEXT NOT NULL,
  -- Normalized sort key: YYYY-Qx for quarter labels, YYYY-MM-DD for date-style
  sort_key            TEXT NOT NULL,
  profit              NUMERIC(14,2) NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quarterly_updates_book_idx
  ON quarterly_updates (tracked_book_id, sort_key);
CREATE INDEX IF NOT EXISTS quarterly_updates_user_idx
  ON quarterly_updates (user_id);

ALTER TABLE quarterly_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quarterly_updates: owner read"   ON quarterly_updates;
DROP POLICY IF EXISTS "quarterly_updates: owner insert" ON quarterly_updates;
DROP POLICY IF EXISTS "quarterly_updates: owner update" ON quarterly_updates;
DROP POLICY IF EXISTS "quarterly_updates: owner delete" ON quarterly_updates;

CREATE POLICY "quarterly_updates: owner read"   ON quarterly_updates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "quarterly_updates: owner insert" ON quarterly_updates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quarterly_updates: owner update" ON quarterly_updates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "quarterly_updates: owner delete" ON quarterly_updates FOR DELETE USING (auth.uid() = user_id);


-- Bundles group related books (originals + translations, box sets) so the
-- rollup view can show combined dev cost vs combined profit across editions.
CREATE TABLE IF NOT EXISTS book_bundles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE book_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_bundles: owner read"   ON book_bundles;
DROP POLICY IF EXISTS "book_bundles: owner insert" ON book_bundles;
DROP POLICY IF EXISTS "book_bundles: owner update" ON book_bundles;
DROP POLICY IF EXISTS "book_bundles: owner delete" ON book_bundles;

CREATE POLICY "book_bundles: owner read"   ON book_bundles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "book_bundles: owner insert" ON book_bundles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "book_bundles: owner update" ON book_bundles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "book_bundles: owner delete" ON book_bundles FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS tracked_book_bundle_members (
  bundle_id           UUID NOT NULL REFERENCES book_bundles(id) ON DELETE CASCADE,
  tracked_book_id     UUID NOT NULL REFERENCES tracked_books(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, tracked_book_id)
);

CREATE INDEX IF NOT EXISTS tracked_book_bundle_members_book_idx
  ON tracked_book_bundle_members (tracked_book_id);

ALTER TABLE tracked_book_bundle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracked_book_bundle_members: owner read"   ON tracked_book_bundle_members;
DROP POLICY IF EXISTS "tracked_book_bundle_members: owner insert" ON tracked_book_bundle_members;
DROP POLICY IF EXISTS "tracked_book_bundle_members: owner update" ON tracked_book_bundle_members;
DROP POLICY IF EXISTS "tracked_book_bundle_members: owner delete" ON tracked_book_bundle_members;

CREATE POLICY "tracked_book_bundle_members: owner read"   ON tracked_book_bundle_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tracked_book_bundle_members: owner insert" ON tracked_book_bundle_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tracked_book_bundle_members: owner update" ON tracked_book_bundle_members FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "tracked_book_bundle_members: owner delete" ON tracked_book_bundle_members FOR DELETE USING (auth.uid() = user_id);
