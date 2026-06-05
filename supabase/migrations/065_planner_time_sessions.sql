-- ============================================
-- Planner v11 — time-tracking session log
--
--   planner_time_sessions   One row per start→stop run of a to-do's timer, with
--                           the interval's timestamps and its length in minutes.
--                           This lets Stats attribute tracked time to the day it
--                           was actually worked — independent of whether the
--                           to-do is ever completed. (planner_tasks.actual_minutes
--                           stays as the per-to-do running total for display.)
--
--   Owner-only via RLS, like the rest of the planner.
-- ============================================

CREATE TABLE IF NOT EXISTS planner_time_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES planner_tasks(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ NOT NULL,
  minutes     INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS planner_time_sessions_user_started_idx
  ON planner_time_sessions (user_id, started_at);

ALTER TABLE planner_time_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planner_time_sessions: owner read"   ON planner_time_sessions;
DROP POLICY IF EXISTS "planner_time_sessions: owner insert" ON planner_time_sessions;
DROP POLICY IF EXISTS "planner_time_sessions: owner update" ON planner_time_sessions;
DROP POLICY IF EXISTS "planner_time_sessions: owner delete" ON planner_time_sessions;

CREATE POLICY "planner_time_sessions: owner read"   ON planner_time_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "planner_time_sessions: owner insert" ON planner_time_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "planner_time_sessions: owner update" ON planner_time_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "planner_time_sessions: owner delete" ON planner_time_sessions FOR DELETE USING (auth.uid() = user_id);
