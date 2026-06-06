-- ============================================
-- Planner v13 — Orbit (currently-relevant staging area)
--
--   planner_tasks.in_orbit       True when a to-do is "in orbit" — flagged as
--                                currently relevant so it surfaces first in
--                                Focus and is easy to pull into your day.
--   planner_settings.orbit_enabled  Whether the Orbit feature is shown at all
--                                (a rail view + the per-to-do toggle). Off by
--                                default so it's opt-in.
-- ============================================

ALTER TABLE planner_tasks
  ADD COLUMN IF NOT EXISTS in_orbit BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS orbit_enabled BOOLEAN NOT NULL DEFAULT false;
