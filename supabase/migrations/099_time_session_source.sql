-- Time sessions can now be created three ways: by a running timer ('timer'),
-- by manually logging minutes ('manual'/'timer'), or DERIVED from a timed block
-- when its to-dos are checked off ('block'). Tagging the source lets the app
-- reverse just the block-derived time when a to-do is un-checked, without
-- touching real timer runs.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

alter table planner_time_sessions
  add column if not exists source text not null default 'timer';
