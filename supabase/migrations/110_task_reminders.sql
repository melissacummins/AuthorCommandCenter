-- Task reminders: an optional time to be nudged about a to-do. A scheduled job
-- (Vercel Cron → /api/planner/ai?action=reminders) emails the owner when
-- remind_at passes, then stamps reminder_sent_at so it fires exactly once.
-- Changing remind_at clears reminder_sent_at (client-side) so it can fire again.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

alter table planner_tasks add column if not exists remind_at        timestamptz;
alter table planner_tasks add column if not exists reminder_sent_at timestamptz;

-- The cron scans for due, unsent reminders on open to-dos — index that path.
create index if not exists planner_tasks_remind_due_idx
  on planner_tasks (remind_at)
  where remind_at is not null and reminder_sent_at is null;
