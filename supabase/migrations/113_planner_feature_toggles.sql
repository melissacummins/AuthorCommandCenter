-- Feature toggles on the planner, matching the existing Orbit switch: let a user
-- turn the Weekly Reset and the Working Phases strategy on or off. Both default
-- ON so nothing changes for existing users until they opt out.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

alter table planner_settings add column if not exists weekly_reset_enabled    boolean not null default true;
alter table planner_settings add column if not exists working_phases_enabled  boolean not null default true;
