-- ============================================
-- Phase 2: ARC reader ↔ Catalog book junction
--   Replaces the loose TEXT[] columns (applied_for / received /
--   reviewed) on arc_readers with a proper junction that lets us
--   join to Catalog books and record *when* each transition happened.
--   Each row is also a Timeline event in the making — when the
--   timeline view lands it'll project these directly.
--
--   The legacy TEXT[] columns stay on arc_readers for one round as a
--   safety net while we cut over the UI. New code reads/writes the
--   junction; the TEXT[] columns will be dropped in a later PR once
--   the user confirms nothing in their data was missed.
--
--   Backfill runs in this migration via a DO block that matches
--   existing titles against Catalog. Anything that can't be matched
--   lands in arc_readers.unmatched_titles for surfacing in the UI so
--   the user can manually link or discard.
-- ============================================

CREATE TABLE IF NOT EXISTS arc_reader_books (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reader_id     UUID NOT NULL REFERENCES arc_readers(id) ON DELETE CASCADE,
  book_id       UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  relationship  TEXT NOT NULL
                  CHECK (relationship IN ('applied','received','reviewed')),
  -- Source of the event for future timeline rendering. Defaults to
  -- now() for live UI edits; the backfill uses the reader's
  -- created_at so historical entries don't all collapse to today.
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (reader_id, book_id, relationship)
);

CREATE INDEX IF NOT EXISTS arc_reader_books_user_idx     ON arc_reader_books (user_id);
CREATE INDEX IF NOT EXISTS arc_reader_books_reader_idx   ON arc_reader_books (reader_id);
CREATE INDEX IF NOT EXISTS arc_reader_books_book_idx     ON arc_reader_books (book_id);
CREATE INDEX IF NOT EXISTS arc_reader_books_recorded_idx ON arc_reader_books (user_id, recorded_at DESC);

ALTER TABLE arc_reader_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arc_reader_books: owner read"   ON arc_reader_books;
DROP POLICY IF EXISTS "arc_reader_books: owner insert" ON arc_reader_books;
DROP POLICY IF EXISTS "arc_reader_books: owner update" ON arc_reader_books;
DROP POLICY IF EXISTS "arc_reader_books: owner delete" ON arc_reader_books;

CREATE POLICY "arc_reader_books: owner read"   ON arc_reader_books FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "arc_reader_books: owner insert" ON arc_reader_books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "arc_reader_books: owner update" ON arc_reader_books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "arc_reader_books: owner delete" ON arc_reader_books FOR DELETE USING (auth.uid() = user_id);


-- Holds titles from the legacy TEXT[] columns that couldn't be matched
-- to a Catalog book during backfill. Shape:
--   { applied: ['t1','t2'], received: [...], reviewed: [...] }
-- UI surfaces these so the user can either add the book to Catalog
-- and re-link, or discard the entry.
ALTER TABLE arc_readers
  ADD COLUMN IF NOT EXISTS unmatched_titles JSONB NOT NULL DEFAULT '{}'::jsonb;


-- ============================================
-- One-time backfill
--   Runs only when arc_reader_books is empty so re-running the
--   migration against a partially-populated table doesn't duplicate.
--   Match is case-insensitive on trimmed title within the same user_id.
-- ============================================
DO $$
DECLARE
  reader RECORD;
  t TEXT;
  matched_book_id UUID;
  unmatched_applied  TEXT[];
  unmatched_received TEXT[];
  unmatched_reviewed TEXT[];
BEGIN
  IF EXISTS (SELECT 1 FROM arc_reader_books LIMIT 1) THEN
    RAISE NOTICE 'arc_reader_books already populated; skipping backfill';
    RETURN;
  END IF;

  FOR reader IN
    SELECT id, user_id, applied_for, received, reviewed, created_at
    FROM arc_readers
  LOOP
    unmatched_applied  := '{}';
    unmatched_received := '{}';
    unmatched_reviewed := '{}';

    FOREACH t IN ARRAY COALESCE(reader.applied_for, '{}') LOOP
      IF t IS NULL OR length(trim(t)) = 0 THEN CONTINUE; END IF;
      SELECT id INTO matched_book_id
        FROM books
        WHERE user_id = reader.user_id
          AND lower(title) = lower(trim(t))
        LIMIT 1;
      IF matched_book_id IS NOT NULL THEN
        INSERT INTO arc_reader_books (user_id, reader_id, book_id, relationship, recorded_at)
        VALUES (reader.user_id, reader.id, matched_book_id, 'applied', reader.created_at)
        ON CONFLICT (reader_id, book_id, relationship) DO NOTHING;
      ELSE
        unmatched_applied := array_append(unmatched_applied, t);
      END IF;
    END LOOP;

    FOREACH t IN ARRAY COALESCE(reader.received, '{}') LOOP
      IF t IS NULL OR length(trim(t)) = 0 THEN CONTINUE; END IF;
      SELECT id INTO matched_book_id
        FROM books
        WHERE user_id = reader.user_id
          AND lower(title) = lower(trim(t))
        LIMIT 1;
      IF matched_book_id IS NOT NULL THEN
        INSERT INTO arc_reader_books (user_id, reader_id, book_id, relationship, recorded_at)
        VALUES (reader.user_id, reader.id, matched_book_id, 'received', reader.created_at)
        ON CONFLICT (reader_id, book_id, relationship) DO NOTHING;
      ELSE
        unmatched_received := array_append(unmatched_received, t);
      END IF;
    END LOOP;

    FOREACH t IN ARRAY COALESCE(reader.reviewed, '{}') LOOP
      IF t IS NULL OR length(trim(t)) = 0 THEN CONTINUE; END IF;
      SELECT id INTO matched_book_id
        FROM books
        WHERE user_id = reader.user_id
          AND lower(title) = lower(trim(t))
        LIMIT 1;
      IF matched_book_id IS NOT NULL THEN
        INSERT INTO arc_reader_books (user_id, reader_id, book_id, relationship, recorded_at)
        VALUES (reader.user_id, reader.id, matched_book_id, 'reviewed', reader.created_at)
        ON CONFLICT (reader_id, book_id, relationship) DO NOTHING;
      ELSE
        unmatched_reviewed := array_append(unmatched_reviewed, t);
      END IF;
    END LOOP;

    IF COALESCE(array_length(unmatched_applied,  1), 0) > 0
    OR COALESCE(array_length(unmatched_received, 1), 0) > 0
    OR COALESCE(array_length(unmatched_reviewed, 1), 0) > 0 THEN
      UPDATE arc_readers
      SET unmatched_titles = jsonb_build_object(
            'applied',  to_jsonb(unmatched_applied),
            'received', to_jsonb(unmatched_received),
            'reviewed', to_jsonb(unmatched_reviewed)
          )
      WHERE id = reader.id;
    END IF;
  END LOOP;
END
$$;
