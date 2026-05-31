-- ============================================
-- Planner v6 — flag a to-do as Important
--
--   flagged   When true, the to-do is "Important" (a yellow-star priority, in
--             the spirit of Things 3). Lists offer an All / Important filter
--             that narrows to flagged to-dos. NULL is never used — default
--             false so existing rows are simply "not important".
-- ============================================

ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;
