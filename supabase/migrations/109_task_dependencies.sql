-- Task dependencies: a to-do can be "blocked by" one or more other to-dos. When
-- a blocker isn't done, the dependent to-do is considered blocked. Modeled as a
-- directed edge task_id -> depends_on_id ("task_id is blocked by depends_on_id").
-- Both ends cascade-delete so removing a to-do cleans up its edges.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

create table if not exists planner_task_dependencies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  task_id       uuid not null references planner_tasks(id) on delete cascade,  -- the blocked to-do
  depends_on_id uuid not null references planner_tasks(id) on delete cascade,  -- its blocker
  created_at    timestamptz not null default now(),
  unique (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create index if not exists planner_task_dependencies_task_idx on planner_task_dependencies (task_id);
create index if not exists planner_task_dependencies_dep_idx on planner_task_dependencies (depends_on_id);

alter table planner_task_dependencies enable row level security;

drop policy if exists "planner_task_dependencies owner" on planner_task_dependencies;
create policy "planner_task_dependencies owner" on planner_task_dependencies
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
