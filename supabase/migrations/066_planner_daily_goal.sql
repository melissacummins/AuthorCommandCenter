-- ============================================
-- Planner v12 — daily completion goal
--
--   daily_goal_count   How many to-dos you're aiming to complete in a day. The
--                      My Day progress bar fills toward this and celebrates when
--                      you hit it. NULL turns the goal off. Defaults to 3 so the
--                      feature is discoverable; clear it to hide.
-- ============================================

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS daily_goal_count INTEGER DEFAULT 3;
