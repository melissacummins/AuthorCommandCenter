-- ============================================
-- Writing: manuscripts + chapters (+ revisions table for Phase 2)
--   A manuscript holds an imported or hand-started draft, optionally linked
--   to a Catalog book (loose link, audiobook-style: deleting the book just
--   detaches it). Chapters are the ordered, HTML-formatted pieces produced
--   by import's chapter-split review step (or added by hand later).
--
--   manuscript_revisions is created now so the schema ships once, but is not
--   populated until Phase 2 (editor autosave snapshots).
-- ============================================

CREATE TABLE IF NOT EXISTS manuscripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional link to a Catalog book (kept loose: deleting the book just
  -- detaches it, the manuscript survives).
  book_id         UUID REFERENCES books(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,
  -- draft → revising → final (advisory; UI drives the flow).
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'revising', 'final')),

  -- Original uploaded filename, if this manuscript came from an import.
  source_filename TEXT,

  -- Denormalized rollup of manuscript_chapters.word_count, kept in sync by
  -- the app on chapter save (mirrors books.word_count's role in Catalog).
  word_count      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manuscripts_user_idx ON manuscripts(user_id);
CREATE INDEX IF NOT EXISTS manuscripts_user_updated_idx ON manuscripts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS manuscripts_book_idx ON manuscripts(book_id);

ALTER TABLE manuscripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manuscripts: owner read"   ON manuscripts;
DROP POLICY IF EXISTS "Manuscripts: owner insert" ON manuscripts;
DROP POLICY IF EXISTS "Manuscripts: owner update" ON manuscripts;
DROP POLICY IF EXISTS "Manuscripts: owner delete" ON manuscripts;

CREATE POLICY "Manuscripts: owner read"   ON manuscripts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscripts: owner insert" ON manuscripts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Manuscripts: owner update" ON manuscripts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscripts: owner delete" ON manuscripts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================

CREATE TABLE IF NOT EXISTS manuscript_chapters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manuscript_id   UUID NOT NULL REFERENCES manuscripts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Ordering within the manuscript (0-based, gaps allowed after edits).
  idx             INTEGER NOT NULL DEFAULT 0,
  title           TEXT NOT NULL DEFAULT '',

  -- Canonical chapter content. HTML (not plain text) so italics/bold survive
  -- a DOCX import round-trip and a future TipTap editor can edit it natively.
  content_html    TEXT NOT NULL DEFAULT '',
  word_count      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manuscript_chapters_manuscript_idx ON manuscript_chapters(manuscript_id, idx);
CREATE INDEX IF NOT EXISTS manuscript_chapters_user_idx ON manuscript_chapters(user_id);

ALTER TABLE manuscript_chapters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manuscript chapters: owner read"   ON manuscript_chapters;
DROP POLICY IF EXISTS "Manuscript chapters: owner insert" ON manuscript_chapters;
DROP POLICY IF EXISTS "Manuscript chapters: owner update" ON manuscript_chapters;
DROP POLICY IF EXISTS "Manuscript chapters: owner delete" ON manuscript_chapters;

CREATE POLICY "Manuscript chapters: owner read"   ON manuscript_chapters FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript chapters: owner insert" ON manuscript_chapters FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Manuscript chapters: owner update" ON manuscript_chapters FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript chapters: owner delete" ON manuscript_chapters FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- Phase 2 table, schema-only for now (no app code writes to this yet).
-- ============================================

CREATE TABLE IF NOT EXISTS manuscript_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id      UUID NOT NULL REFERENCES manuscript_chapters(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  content_html    TEXT NOT NULL,
  word_count      INTEGER NOT NULL DEFAULT 0,
  -- 'autosnapshot' or a user-supplied label.
  label           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manuscript_revisions_chapter_idx ON manuscript_revisions(chapter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manuscript_revisions_user_idx ON manuscript_revisions(user_id);

ALTER TABLE manuscript_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manuscript revisions: owner read"   ON manuscript_revisions;
DROP POLICY IF EXISTS "Manuscript revisions: owner insert" ON manuscript_revisions;
DROP POLICY IF EXISTS "Manuscript revisions: owner update" ON manuscript_revisions;
DROP POLICY IF EXISTS "Manuscript revisions: owner delete" ON manuscript_revisions;

CREATE POLICY "Manuscript revisions: owner read"   ON manuscript_revisions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript revisions: owner insert" ON manuscript_revisions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Manuscript revisions: owner update" ON manuscript_revisions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Manuscript revisions: owner delete" ON manuscript_revisions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- updated_at triggers (shared function pattern used across the schema)
-- ============================================

CREATE OR REPLACE FUNCTION manuscripts_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS manuscripts_updated_at ON manuscripts;
CREATE TRIGGER manuscripts_updated_at
  BEFORE UPDATE ON manuscripts
  FOR EACH ROW EXECUTE FUNCTION manuscripts_set_updated_at();

DROP TRIGGER IF EXISTS manuscript_chapters_updated_at ON manuscript_chapters;
CREATE TRIGGER manuscript_chapters_updated_at
  BEFORE UPDATE ON manuscript_chapters
  FOR EACH ROW EXECUTE FUNCTION manuscripts_set_updated_at();
