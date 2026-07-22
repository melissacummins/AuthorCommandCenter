-- Reusable templates for the planner. A template is either a whole LIST (a
-- title + a set of to-dos/headings you can spin up again — e.g. a launch
-- checklist) or a single TASK (a to-do with its estimate/tags/checklist you
-- reuse often). The structure is stored as JSON so instantiating is a pure
-- client-side create; nothing here references live tasks.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

create table if not exists planner_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('list', 'task')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists planner_templates_user_idx on planner_templates (user_id, kind, created_at desc);

alter table planner_templates enable row level security;

drop policy if exists "planner_templates owner" on planner_templates;
create policy "planner_templates owner" on planner_templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
