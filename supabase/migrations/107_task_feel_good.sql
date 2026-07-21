-- Bring the Weekly Reset's tags to every list. Priority already maps to the
-- existing `flagged` star and Quick to a 15-minute estimate, but "feel-good"
-- had no home outside a reset's `reset_section`. This adds it as a first-class
-- tag on any to-do so it can be set (and filtered) anywhere, not just at reset.
--
-- Idempotent: safe for Supabase Preview Branching to re-apply.

alter table planner_tasks
  add column if not exists feel_good boolean not null default false;
