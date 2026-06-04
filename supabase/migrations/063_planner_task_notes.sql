-- ============================================
-- Planner v9 — freeform notes / body on a to-do
--
--   notes   Optional long-form body for a to-do: a draft, links, context —
--           anything that doesn't fit in the one-line title. NULL/empty when
--           unused. Edited from an expandable area on the to-do row.
-- ============================================

ALTER TABLE planner_tasks
  ADD COLUMN IF NOT EXISTS notes TEXT;
