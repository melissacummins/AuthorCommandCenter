-- ============================================
-- Planner v4 — calendar time-blocking
--
--   When a to-do is placed on Google Calendar as a time block, we remember the
--   link so the planner can update or remove that event later, and the start
--   time so the to-do can render at the right spot on the day.
--
--   start_at        Optional timed start for the to-do (a time block). NULL =
--                   day-level only (just due_date).
--   gcal_event_id   The linked Google Calendar event id, or NULL if the to-do
--                   isn't on the calendar.
--
--   Google Calendar itself is reached browser-side via OAuth (no backend), so
--   there are no tokens or secrets stored in the database.
-- ============================================

ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS start_at      TIMESTAMPTZ;
ALTER TABLE planner_tasks ADD COLUMN IF NOT EXISTS gcal_event_id TEXT;
