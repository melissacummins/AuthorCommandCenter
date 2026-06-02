-- ============================================
-- Planner v7 — carry yesterday's overage into today's capacity
--
--   carry_over_capacity  When true, the My Day capacity bar lowers the day's
--                        target by however much the previous day was *over* its
--                        target, rounded to the nearest hour (floored at zero).
--                        Opt-in; default false so existing users keep a flat
--                        daily target until they turn it on.
-- ============================================

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS carry_over_capacity BOOLEAN NOT NULL DEFAULT false;
