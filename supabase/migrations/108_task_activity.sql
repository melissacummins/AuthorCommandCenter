-- Per-to-do activity history (ClickUp-style): a lightweight event stream so a
-- to-do's detail panel can show when it was created, edited, scheduled,
-- completed, reopened, repeated, etc. Events cascade-delete with their task.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

create table if not exists planner_task_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references planner_tasks(id) on delete cascade,
  type       text not null,          -- created | completed | reopened | repeated | scheduled | unscheduled | moved | flagged | unflagged | estimated | renamed | edited
  detail     text,                   -- optional human context (a date, minutes, …)
  created_at timestamptz not null default now()
);

create index if not exists planner_task_events_task_idx
  on planner_task_events (task_id, created_at desc);

alter table planner_task_events enable row level security;

drop policy if exists "planner_task_events owner" on planner_task_events;
create policy "planner_task_events owner" on planner_task_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
