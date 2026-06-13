-- ============================================
-- Planner: allow biweekly + custom "every N days/weeks/months" recurrence.
--
-- The recurrence column (added in 056) was CHECK-constrained to exactly
-- daily/weekdays/weekly/monthly. Widen it to also accept 'biweekly' and a
-- custom encoding 'every:<n>:<unit>' (e.g. 'every:2:week' for biweekly,
-- 'every:3:day', 'every:6:month'). nextDueDate() in the app parses these.
--
-- Per CLAUDE.md: idempotent so Supabase Preview Branching can re-apply it.
-- ============================================

ALTER TABLE planner_tasks DROP CONSTRAINT IF EXISTS planner_tasks_recurrence_check;

ALTER TABLE planner_tasks
  ADD CONSTRAINT planner_tasks_recurrence_check
  CHECK (
    recurrence IS NULL
    OR recurrence IN ('daily', 'weekdays', 'weekly', 'biweekly', 'monthly')
    OR recurrence ~ '^every:[1-9][0-9]*:(day|week|month)$'
  );
