-- ============================================
-- Writing Phase 3.5: manuscript-level word-count goal + daily word logs
--   The word-count goal moves from the linked Catalog book
--   (books.target_word_count) onto the manuscript itself, so Analytics works
--   even for manuscripts with no Catalog link. manuscript_word_logs mirrors
--   book_word_logs (one row per manuscript per day, upserted by the same
--   syncWordCount path that already rolls counts up to the linked book).
-- ============================================

ALTER TABLE manuscripts ADD COLUMN IF NOT EXISTS target_word_count INTEGER;

CREATE TABLE IF NOT EXISTS manuscript_word_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manuscript_id   UUID NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,

  day             DATE NOT NULL,
  word_count      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (manuscript_id, day)
);

CREATE INDEX IF NOT EXISTS manuscript_word_logs_user_idx ON manuscript_word_logs(user_id);
CREATE INDEX IF NOT EXISTS manuscript_word_logs_manuscript_day_idx ON manuscript_word_logs(manuscript_id, day);

ALTER TABLE manuscript_word_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manuscript word logs: owner read"   ON manuscript_word_logs;
DROP POLICY IF EXISTS "Manuscript word logs: owner insert" ON manuscript_word_logs;
DROP POLICY IF EXISTS "Manuscript word logs: owner update" ON manuscript_word_logs;
DROP POLICY IF EXISTS "Manuscript word logs: owner delete" ON manuscript_word_logs;

CREATE POLICY "Manuscript word logs: owner read"   ON manuscript_word_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript word logs: owner insert" ON manuscript_word_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Manuscript word logs: owner update" ON manuscript_word_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript word logs: owner delete" ON manuscript_word_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS manuscript_word_logs_updated_at ON manuscript_word_logs;
CREATE TRIGGER manuscript_word_logs_updated_at
  BEFORE UPDATE ON manuscript_word_logs
  FOR EACH ROW EXECUTE FUNCTION manuscripts_set_updated_at();
