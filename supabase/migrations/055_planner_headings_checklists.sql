-- ============================================
-- Planner v2 — headings + checklists
--
--   Two additions to planner_tasks so a note can read like a Things 3 project:
--
--   kind       'task' (a normal to-do) or 'heading' (a section divider that
--              groups the tasks ordered beneath it). Headings never show up in
--              the Today/Upcoming/Anytime/Someday smart views.
--
--   checklist  A to-do's own sub-steps, stored inline as JSONB:
--                [{ "id": "...", "title": "...", "done": false }]
--              Small and always loaded with the task, so no separate table.
-- ============================================

ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS kind      TEXT  NOT NULL DEFAULT 'task';
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Constrain kind to the two known values. Dropped first so re-running the
-- migration (Supabase Preview Branching) doesn't error on a duplicate.
ALTER TABLE planner_tasks DROP CONSTRAINT IF EXISTS planner_tasks_kind_check;
ALTER TABLE planner_tasks
  ADD CONSTRAINT planner_tasks_kind_check CHECK (kind IN ('task', 'heading'));
