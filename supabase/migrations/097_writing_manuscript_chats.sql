-- ============================================
-- Writing: manuscript-aware AI chat
--   One assistant thread per manuscript (directive Phase 3 §6.3) — messages
--   are stored flat against manuscript_id rather than behind a separate
--   "session" wrapper, since there's exactly one thread per manuscript.
-- ============================================

CREATE TABLE IF NOT EXISTS manuscript_chats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manuscript_id UUID NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content       TEXT NOT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manuscript_chats_manuscript_idx ON manuscript_chats(manuscript_id, created_at);
CREATE INDEX IF NOT EXISTS manuscript_chats_user_idx ON manuscript_chats(user_id);

ALTER TABLE manuscript_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manuscript chats: owner read"   ON manuscript_chats;
DROP POLICY IF EXISTS "Manuscript chats: owner insert" ON manuscript_chats;
DROP POLICY IF EXISTS "Manuscript chats: owner update" ON manuscript_chats;
DROP POLICY IF EXISTS "Manuscript chats: owner delete" ON manuscript_chats;

CREATE POLICY "Manuscript chats: owner read"   ON manuscript_chats FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript chats: owner insert" ON manuscript_chats FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Manuscript chats: owner update" ON manuscript_chats FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript chats: owner delete" ON manuscript_chats FOR DELETE TO authenticated USING (auth.uid() = user_id);
