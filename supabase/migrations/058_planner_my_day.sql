-- ============================================
-- Planner v5 — "My Day" (day-focused planning)
--
--   Replaces the month-grid Calendar tab with a day-at-a-time planner. Three
--   small additions support it:
--
--   planner_settings    One row per user. daily_capacity_minutes is the amount
--                       of focused work you want to commit to in a day; the My
--                       Day capacity bar compares your planned load against it
--                       and warns when you've over-committed. (Roadmap: learn
--                       this from your own 30-day history instead of a fixed
--                       target.)
--
--   planner_day_notes   One freeform note per calendar day — feelings, wins,
--                       ideas — keyed by (user_id, day). Separate from
--                       planner_notes (which are named, reusable lists).
--
--   planner_time_blocks A named block of time on a given day ("Writing
--                       9–11am") that groups to-dos. Optional start/end minutes
--                       (minutes from local midnight) place it on the day;
--                       gcal_event_id links it to a Google Calendar event when
--                       synced. To-dos join a block via planner_tasks.block_id.
--
--   planner_tasks.block_id   Which time block (if any) a to-do belongs to.
--                            ON DELETE SET NULL so deleting a block just frees
--                            its to-dos back into the day rather than removing
--                            them. A to-do can still be scheduled directly
--                            (start_at) without a block — both flows coexist.
--
--   Everything stays owner-only via RLS.
-- ============================================

-- ---- planner_settings -----------------------------------------------------

CREATE TABLE IF NOT EXISTS planner_settings (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_capacity_minutes INTEGER NOT NULL DEFAULT 240,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE planner_settings ADD COLUMN IF NOT EXISTS daily_capacity_minutes INTEGER NOT NULL DEFAULT 240;

ALTER TABLE planner_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_settings: owner read"   ON planner_settings;
DROP POLICY IF EXISTS "planner_settings: owner insert" ON planner_settings;
DROP POLICY IF EXISTS "planner_settings: owner update" ON planner_settings;
DROP POLICY IF EXISTS "planner_settings: owner delete" ON planner_settings;

CREATE POLICY "planner_settings: owner read"   ON planner_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_settings: owner insert" ON planner_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_settings: owner update" ON planner_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_settings: owner delete" ON planner_settings FOR DELETE USING (auth.uid() = user_id);


-- ---- planner_day_notes ----------------------------------------------------

CREATE TABLE IF NOT EXISTS planner_day_notes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE planner_day_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_day_notes: owner read"   ON planner_day_notes;
DROP POLICY IF EXISTS "planner_day_notes: owner insert" ON planner_day_notes;
DROP POLICY IF EXISTS "planner_day_notes: owner update" ON planner_day_notes;
DROP POLICY IF EXISTS "planner_day_notes: owner delete" ON planner_day_notes;

CREATE POLICY "planner_day_notes: owner read"   ON planner_day_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_day_notes: owner insert" ON planner_day_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_day_notes: owner update" ON planner_day_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_day_notes: owner delete" ON planner_day_notes FOR DELETE USING (auth.uid() = user_id);


-- ---- planner_time_blocks --------------------------------------------------

CREATE TABLE IF NOT EXISTS planner_time_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  day           DATE NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  -- Minutes from local midnight; NULL = an unscheduled "bucket" block.
  start_minute  INTEGER,
  end_minute    INTEGER,
  gcal_event_id TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS planner_time_blocks_user_day_idx
  ON planner_time_blocks (user_id, day, sort_order);

ALTER TABLE planner_time_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_time_blocks: owner read"   ON planner_time_blocks;
DROP POLICY IF EXISTS "planner_time_blocks: owner insert" ON planner_time_blocks;
DROP POLICY IF EXISTS "planner_time_blocks: owner update" ON planner_time_blocks;
DROP POLICY IF EXISTS "planner_time_blocks: owner delete" ON planner_time_blocks;

CREATE POLICY "planner_time_blocks: owner read"   ON planner_time_blocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_time_blocks: owner insert" ON planner_time_blocks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_time_blocks: owner update" ON planner_time_blocks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_time_blocks: owner delete" ON planner_time_blocks FOR DELETE USING (auth.uid() = user_id);


-- ---- planner_tasks.block_id ----------------------------------------------

ALTER TABLE planner_tasks
  ADD COLUMN IF NOT EXISTS block_id UUID REFERENCES planner_time_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS planner_tasks_block_idx
  ON planner_tasks (block_id);
