-- ============================================
-- Opportunity decisions (Command Center redesign Phase 1, directive §3.4)
--   The opportunity engine derives suggestions ("translate X into German",
--   "make Y's audiobook") from the catalog. This table records Melissa's
--   call on a suggestion so it stops nagging:
--     dismissed — not doing this; hide it from the Home widget, score 0
--     planned   — will do this; shown as a todo on the Catalog checklist
--   One row per (user, book, opportunity key); deleting the book clears
--   its decisions.
-- ============================================

CREATE TABLE IF NOT EXISTS book_opportunity_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  -- Engine-stable key, e.g. 'translation:de', 'audiobook', 'format:paperback', 'kdp', 'arc'.
  opportunity_key TEXT NOT NULL,
  decision        TEXT NOT NULL DEFAULT 'dismissed'
    CHECK (decision IN ('dismissed', 'planned')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, book_id, opportunity_key)
);

CREATE INDEX IF NOT EXISTS book_opportunity_decisions_user_idx
  ON book_opportunity_decisions(user_id);
CREATE INDEX IF NOT EXISTS book_opportunity_decisions_book_idx
  ON book_opportunity_decisions(book_id);

ALTER TABLE book_opportunity_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Opportunity decisions: owner read"   ON book_opportunity_decisions;
DROP POLICY IF EXISTS "Opportunity decisions: owner insert" ON book_opportunity_decisions;
DROP POLICY IF EXISTS "Opportunity decisions: owner update" ON book_opportunity_decisions;
DROP POLICY IF EXISTS "Opportunity decisions: owner delete" ON book_opportunity_decisions;

CREATE POLICY "Opportunity decisions: owner read"   ON book_opportunity_decisions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Opportunity decisions: owner insert" ON book_opportunity_decisions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Opportunity decisions: owner update" ON book_opportunity_decisions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Opportunity decisions: owner delete" ON book_opportunity_decisions FOR DELETE TO authenticated USING (auth.uid() = user_id);
