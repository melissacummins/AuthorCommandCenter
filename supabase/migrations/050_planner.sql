-- ============================================
-- Planner
--   A lightweight Things-3 / NotePlan-style planner. Two tables:
--
--   planner_notes  — named lists / brain-dumps ("Webinar prep", "Ad ideas").
--                    A note has a title, a freeform body, and a checklist of
--                    tasks. Pinned notes float to the top; archived notes drop
--                    out of the active list.
--
--   planner_tasks  — the checkable items. A task usually belongs to a note,
--                    but note_id is nullable so the Home "Today" panel can
--                    capture a loose to-do without forcing you to file it.
--
--   Scheduling (the four Things buckets) is derived in the app layer from two
--   columns: due_date and someday.
--     • due_date <= today, not done            -> Today (includes overdue)
--     • due_date  > today                       -> Upcoming
--     • due_date NULL and someday = false       -> Anytime
--     • someday = true                          -> Someday
--
--   Everything is owner-only via RLS; each member sees just their own rows.
-- ============================================

CREATE TABLE IF NOT EXISTS planner_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',

  pinned      BOOLEAN NOT NULL DEFAULT false,
  archived    BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Heal any pre-existing stub table so the columns below are guaranteed to
-- exist before indexes/policies reference them.
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS title      TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS body       TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS pinned     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS archived   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE planner_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS planner_notes_user_idx
  ON planner_notes (user_id, archived, pinned DESC, sort_order, updated_at DESC);

ALTER TABLE planner_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_notes: owner read"   ON planner_notes;
DROP POLICY IF EXISTS "planner_notes: owner insert" ON planner_notes;
DROP POLICY IF EXISTS "planner_notes: owner update" ON planner_notes;
DROP POLICY IF EXISTS "planner_notes: owner delete" ON planner_notes;

CREATE POLICY "planner_notes: owner read"   ON planner_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_notes: owner insert" ON planner_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_notes: owner update" ON planner_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_notes: owner delete" ON planner_notes FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS planner_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id     UUID REFERENCES planner_notes(id) ON DELETE CASCADE,

  title       TEXT NOT NULL DEFAULT '',
  done        BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,

  due_date    DATE,
  someday     BOOLEAN NOT NULL DEFAULT false,

  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS note_id    UUID REFERENCES planner_notes(id) ON DELETE CASCADE;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS title      TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS done       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS done_at    TIMESTAMPTZ;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS due_date   DATE;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS someday    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS planner_tasks_note_idx
  ON planner_tasks (note_id, sort_order);
CREATE INDEX IF NOT EXISTS planner_tasks_user_due_idx
  ON planner_tasks (user_id, done, due_date);

ALTER TABLE planner_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_tasks: owner read"   ON planner_tasks;
DROP POLICY IF EXISTS "planner_tasks: owner insert" ON planner_tasks;
DROP POLICY IF EXISTS "planner_tasks: owner update" ON planner_tasks;
DROP POLICY IF EXISTS "planner_tasks: owner delete" ON planner_tasks;

CREATE POLICY "planner_tasks: owner read"   ON planner_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_tasks: owner insert" ON planner_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_tasks: owner update" ON planner_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_tasks: owner delete" ON planner_tasks FOR DELETE USING (auth.uid() = user_id);
