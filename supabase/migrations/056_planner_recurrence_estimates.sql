-- ============================================
-- Planner v3 — recurring to-dos + time estimates
--
--   recurrence        How often a to-do repeats. NULL = one-off. When a
--                     recurring to-do is completed, the app rolls its due_date
--                     forward to the next occurrence instead of finishing it.
--                       'daily'    every day
--                       'weekdays' Mon–Fri
--                       'weekly'   every 7 days
--                       'monthly'  same day each month
--
--   estimate_minutes  Rough time the to-do will take, so the planner can total
--                     up a day's load (and feed the Daily Business Digest's
--                     hours/capacity awareness). NULL = no estimate.
-- ============================================

ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS recurrence       TEXT;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;

ALTER TABLE planner_tasks DROP CONSTRAINT IF EXISTS planner_tasks_recurrence_check;
ALTER TABLE planner_tasks
  ADD CONSTRAINT planner_tasks_recurrence_check
  CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekdays', 'weekly', 'monthly'));
