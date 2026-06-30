-- Weekly Reset: a once-a-week reflection + capture, keyed to the Monday of its
-- week. The reflective prose (wins, what I didn't do, what drained me, what I
-- want to feel more of) lives here. The actionable items it produces (brain
-- dump, priorities, feel-good, quick tasks, meetings) become planner_tasks,
-- tagged with reset_week + reset_section so Planning can later surface "from
-- this week's reset". Owner-only via RLS.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

create table if not exists weekly_resets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,                       -- Monday of the reset's week
  wins       text not null default '',
  not_done   text not null default '',
  drained    text not null default '',
  feel_more  text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table weekly_resets enable row level security;

drop policy if exists "weekly_resets owner" on weekly_resets;
create policy "weekly_resets owner" on weekly_resets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tag to-dos created from a weekly reset so Planning can group/surface them.
alter table planner_tasks add column if not exists reset_week date;
alter table planner_tasks add column if not exists reset_section text;
