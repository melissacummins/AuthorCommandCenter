-- ============================================
-- Audiobook: chapters layer
--   Adds a chapter between a project and its segments so a whole manuscript can
--   be pasted, scanned into chapters, accepted, and then voiced chapter-by-
--   chapter (mirrors the ElevenLabs Studio flow). A manuscript with no detected
--   chapter headings simply becomes a single chapter, so older flat projects
--   keep working.
--
--   We also persist the raw manuscript on the project so chapters can be re-
--   scanned later without re-pasting.
-- ============================================

-- Raw manuscript text kept on the project (source for chapter scanning).
ALTER TABLE audiobook_projects ADD COLUMN IF NOT EXISTS manuscript TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS audiobook_chapters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES audiobook_projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  idx           INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL DEFAULT 'Chapter',
  -- The chapter's slice of the manuscript (what gets attributed + rendered).
  source_text   TEXT NOT NULL DEFAULT '',

  -- 'draft' | 'attributed' | 'rendered' (advisory; UI drives the flow).
  status        TEXT NOT NULL DEFAULT 'draft',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audiobook_chapters_project_idx ON audiobook_chapters(project_id, idx);
CREATE INDEX IF NOT EXISTS audiobook_chapters_user_idx ON audiobook_chapters(user_id);

ALTER TABLE audiobook_chapters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audiobook chapters: owner read"   ON audiobook_chapters;
DROP POLICY IF EXISTS "Audiobook chapters: owner insert" ON audiobook_chapters;
DROP POLICY IF EXISTS "Audiobook chapters: owner update" ON audiobook_chapters;
DROP POLICY IF EXISTS "Audiobook chapters: owner delete" ON audiobook_chapters;

CREATE POLICY "Audiobook chapters: owner read"   ON audiobook_chapters FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook chapters: owner insert" ON audiobook_chapters FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Audiobook chapters: owner update" ON audiobook_chapters FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook chapters: owner delete" ON audiobook_chapters FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS audiobook_chapters_updated_at ON audiobook_chapters;
CREATE TRIGGER audiobook_chapters_updated_at
  BEFORE UPDATE ON audiobook_chapters
  FOR EACH ROW EXECUTE FUNCTION audiobook_set_updated_at();

-- Tie each segment to its chapter (cascade so deleting a chapter clears its
-- segments). Nullable so any pre-existing flat segments remain valid.
ALTER TABLE audiobook_segments ADD COLUMN IF NOT EXISTS chapter_id UUID REFERENCES audiobook_chapters(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS audiobook_segments_chapter_idx ON audiobook_segments(chapter_id, idx);
