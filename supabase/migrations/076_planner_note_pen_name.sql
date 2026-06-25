-- ============================================
-- Planner list ↔ pen name link
--
--   planner_notes.pen_name_id
--                       Optional link from a planner list (note) to a pen
--                       name. Lets the planner be scoped to a single pen
--                       name — both the rail of lists and every task view —
--                       and lets a list carry its author identity. ON DELETE
--                       SET NULL so deleting a pen name just unlinks its lists.
--
--   Mirrors how migration 070 added planner_notes.book_id.
-- ============================================

ALTER TABLE planner_notes
  ADD COLUMN IF NOT EXISTS pen_name_id UUID REFERENCES pen_names(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS planner_notes_pen_name_idx
  ON planner_notes (user_id, pen_name_id);
