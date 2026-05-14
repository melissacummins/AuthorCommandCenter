-- ============================================
-- ARCs: per-reader records for the ARC (advance reader copy) program
--   * Identity + social profiles
--   * Lifecycle status (current, awaiting review, didn't review, etc.)
--   * Per-book history as text[] of book titles (auto-linked to
--     Catalog books at the application layer when titles match)
--   * Notes + newsletter / promo-team opt-ins
-- ============================================

CREATE TABLE IF NOT EXISTS arc_readers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  name                  TEXT NOT NULL,
  email                 TEXT,
  primary_sm            TEXT,
  ig_profile_url        TEXT,
  tt_profile_url        TEXT,
  goodreads_profile_url TEXT,
  blog_url              TEXT,

  -- Lifecycle
  status                TEXT NOT NULL DEFAULT 'new'
                          CHECK (status IN (
                            'new', 'current_arc_member', 'awaiting_arc', 'awaiting_review',
                            'didnt_review', 'didnt_download', 'on_tbr_no_review',
                            'not_moving_forward', 'special_circumstances',
                            'insufficient_information', 'not_pending_anything'
                          )),

  -- Per-book history (book titles; we resolve to Catalog books when
  -- a title matches exactly).
  applied_for           TEXT[] NOT NULL DEFAULT '{}',
  received              TEXT[] NOT NULL DEFAULT '{}',
  reviewed              TEXT[] NOT NULL DEFAULT '{}',
  awaiting_review_for   TEXT[] NOT NULL DEFAULT '{}',

  -- Where they review (Amazon, Goodreads, etc.)
  place_to_review       TEXT[] NOT NULL DEFAULT '{}',

  -- Opt-ins
  newsletter_subscribed BOOLEAN NOT NULL DEFAULT FALSE,
  promo_team            BOOLEAN NOT NULL DEFAULT FALSE,

  -- Free-form note for anything that doesn't fit a column
  notes                 TEXT,

  -- Notion page id (or any external system id) so re-imports dedupe
  external_id           TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS arc_readers_user_idx        ON arc_readers(user_id);
CREATE INDEX IF NOT EXISTS arc_readers_user_status_idx ON arc_readers(user_id, status);
CREATE INDEX IF NOT EXISTS arc_readers_user_email_idx  ON arc_readers(user_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS arc_readers_user_external_id_idx
  ON arc_readers(user_id, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE arc_readers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own arc_readers" ON arc_readers;
CREATE POLICY "Users read own arc_readers"
  ON arc_readers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own arc_readers" ON arc_readers;
CREATE POLICY "Users insert own arc_readers"
  ON arc_readers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own arc_readers" ON arc_readers;
CREATE POLICY "Users update own arc_readers"
  ON arc_readers FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own arc_readers" ON arc_readers;
CREATE POLICY "Users delete own arc_readers"
  ON arc_readers FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION arc_readers_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arc_readers_updated_at ON arc_readers;
CREATE TRIGGER arc_readers_updated_at
  BEFORE UPDATE ON arc_readers
  FOR EACH ROW EXECUTE FUNCTION arc_readers_set_updated_at();
