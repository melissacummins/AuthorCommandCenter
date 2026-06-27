-- ============================================
-- Audiobook: projects + per-segment narration plan
--   A project holds the cast (which ElevenLabs voice plays narration,
--   the male character, and the female character) and a narration mode.
--   Segments are the ordered, speaker-tagged pieces of the manuscript
--   (produced by the AI attribution pass, then hand-corrected) that get
--   rendered to audio one at a time.
--
--   Voice resolution at render time:
--     narrator_plus_two : narrator→narrator_voice, male→male_voice, female→female_voice
--     duet              : male→male_voice, female→female_voice,
--                         narrator→(narrator_role) voice
-- ============================================

CREATE TABLE IF NOT EXISTS audiobook_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional link to a Catalog book (kept loose: deleting the book just
  -- detaches it, the audiobook project survives).
  book_id       UUID REFERENCES books(id) ON DELETE SET NULL,

  title         TEXT NOT NULL DEFAULT 'Untitled audiobook',

  -- 'narrator_plus_two' = narrator voice + male + female character voices.
  -- 'duet' = just two voices; narration is read by narrator_role's voice.
  narration_mode TEXT NOT NULL DEFAULT 'narrator_plus_two'
    CHECK (narration_mode IN ('narrator_plus_two', 'duet')),
  -- In duet mode, which of the two voices reads the narration.
  narrator_role  TEXT NOT NULL DEFAULT 'female'
    CHECK (narrator_role IN ('male', 'female')),

  -- ElevenLabs voice ids + human-readable names for the cast.
  narrator_voice_id   TEXT,
  narrator_voice_name TEXT,
  male_voice_id       TEXT,
  male_voice_name     TEXT,
  female_voice_id     TEXT,
  female_voice_name   TEXT,

  -- ElevenLabs model used for synthesis (eleven_multilingual_v2, eleven_v3, …).
  model_id      TEXT NOT NULL DEFAULT 'eleven_multilingual_v2',

  -- draft → cast → review → rendering → done (advisory; UI drives the flow).
  status        TEXT NOT NULL DEFAULT 'draft',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audiobook_projects_user_idx ON audiobook_projects(user_id);
CREATE INDEX IF NOT EXISTS audiobook_projects_user_updated_idx ON audiobook_projects(user_id, updated_at DESC);

ALTER TABLE audiobook_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audiobook projects: owner read"   ON audiobook_projects;
DROP POLICY IF EXISTS "Audiobook projects: owner insert" ON audiobook_projects;
DROP POLICY IF EXISTS "Audiobook projects: owner update" ON audiobook_projects;
DROP POLICY IF EXISTS "Audiobook projects: owner delete" ON audiobook_projects;

CREATE POLICY "Audiobook projects: owner read"   ON audiobook_projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook projects: owner insert" ON audiobook_projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Audiobook projects: owner update" ON audiobook_projects FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook projects: owner delete" ON audiobook_projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================

CREATE TABLE IF NOT EXISTS audiobook_segments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES audiobook_projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Ordering within the project (0-based, gaps allowed after edits).
  idx           INTEGER NOT NULL DEFAULT 0,

  -- Who speaks this piece. 'narrator' | 'male' | 'female'.
  speaker       TEXT NOT NULL DEFAULT 'narrator'
    CHECK (speaker IN ('narrator', 'male', 'female')),
  -- Optional character name the AI attributed (e.g. "Elena") — display only.
  character_name TEXT,

  text          TEXT NOT NULL DEFAULT '',

  -- Storage path of the rendered clip (audiobook-audio bucket) once done.
  audio_path    TEXT,
  -- 'pending' | 'rendered' | 'error'
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rendered', 'error')),
  error         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audiobook_segments_project_idx ON audiobook_segments(project_id, idx);
CREATE INDEX IF NOT EXISTS audiobook_segments_user_idx ON audiobook_segments(user_id);

ALTER TABLE audiobook_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audiobook segments: owner read"   ON audiobook_segments;
DROP POLICY IF EXISTS "Audiobook segments: owner insert" ON audiobook_segments;
DROP POLICY IF EXISTS "Audiobook segments: owner update" ON audiobook_segments;
DROP POLICY IF EXISTS "Audiobook segments: owner delete" ON audiobook_segments;

CREATE POLICY "Audiobook segments: owner read"   ON audiobook_segments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook segments: owner insert" ON audiobook_segments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Audiobook segments: owner update" ON audiobook_segments FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Audiobook segments: owner delete" ON audiobook_segments FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- updated_at triggers (shared function pattern used across the schema)
-- ============================================

CREATE OR REPLACE FUNCTION audiobook_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audiobook_projects_updated_at ON audiobook_projects;
CREATE TRIGGER audiobook_projects_updated_at
  BEFORE UPDATE ON audiobook_projects
  FOR EACH ROW EXECUTE FUNCTION audiobook_set_updated_at();

DROP TRIGGER IF EXISTS audiobook_segments_updated_at ON audiobook_segments;
CREATE TRIGGER audiobook_segments_updated_at
  BEFORE UPDATE ON audiobook_segments
  FOR EACH ROW EXECUTE FUNCTION audiobook_set_updated_at();
