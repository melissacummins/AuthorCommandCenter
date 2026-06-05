-- ============================================
-- Planner v10 — auto roll-over + Working Phases
--
--   auto_rollover     When true, unfinished scheduled to-dos from past days are
--                     rolled forward to today on load, instead of piling up in
--                     the Overdue list. Default false.
--   working_phase     The current season of work the user is honoring (one of
--                     sprint / recovery / calibration / building / flow), or
--                     NULL when the Working Phases strategy is off. Drives a
--                     proposed daily target and a My Day guardrail.
--   phase_started_on  The local day the current phase was entered, so a phase
--                     like Recovery can ramp its proposed target over time.
-- ============================================

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS auto_rollover BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS working_phase TEXT;

ALTER TABLE planner_settings
  ADD COLUMN IF NOT EXISTS phase_started_on DATE;
