-- ============================================
-- Planner v8 — per-to-do time tracking
--
--   actual_minutes     Real time worked on a to-do, in minutes, accumulated
--                      across start/stop timer runs. Default 0.
--   timer_started_at   When a timer is currently running for this to-do, the
--                      start of the active run; NULL when stopped. At most one
--                      to-do runs at a time (starting one stops the others),
--                      enforced in the app. Stats read actual_minutes; the live
--                      run is added in the UI until the timer is stopped.
-- ============================================

ALTER TABLE planner_tasks
  ADD COLUMN IF NOT EXISTS actual_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE planner_tasks
  ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;
