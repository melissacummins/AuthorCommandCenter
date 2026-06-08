-- ============================================
-- Catalog progress tracking + Planner list↔book link
--
--   book_word_logs      A dated snapshot of a book's word count. One row per
--                       (book, day) — re-saving the book on the same day
--                       updates that day's snapshot rather than adding a new
--                       one — so the Catalog can chart word count over time
--                       instead of only knowing the latest number.
--
--   planner_notes.book_id
--                       Optional link from a planner list (note) to a Catalog
--                       book. Lets the Catalog roll up the hours tracked on a
--                       book by summing the tracked time of every list tied to
--                       it. ON DELETE SET NULL so deleting a book just unlinks
--                       its lists.
--
--   Owner-only via RLS, like the rest of the app.
-- ============================================

CREATE TABLE IF NOT EXISTS book_word_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  word_count  INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, day)
);

CREATE INDEX IF NOT EXISTS book_word_logs_user_book_day_idx
  ON book_word_logs (user_id, book_id, day);

ALTER TABLE book_word_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_word_logs: owner read"   ON book_word_logs;
DROP POLICY IF EXISTS "book_word_logs: owner insert" ON book_word_logs;
DROP POLICY IF EXISTS "book_word_logs: owner update" ON book_word_logs;
DROP POLICY IF EXISTS "book_word_logs: owner delete" ON book_word_logs;

CREATE POLICY "book_word_logs: owner read"   ON book_word_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "book_word_logs: owner insert" ON book_word_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "book_word_logs: owner update" ON book_word_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "book_word_logs: owner delete" ON book_word_logs FOR DELETE USING (auth.uid() = user_id);

-- Link a planner list (note) to a Catalog book.
ALTER TABLE planner_notes
  ADD COLUMN IF NOT EXISTS book_id UUID REFERENCES books(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS planner_notes_book_idx
  ON planner_notes (user_id, book_id);
