-- ============================================
-- Personal sidebar visibility
--   Lets a signed-in user hide modules from THEIR OWN sidebar without
--   affecting what anyone else sees. This is distinct from the
--   app_modules rollout switches (which the admin uses to gate areas
--   for member tiers) — an admin sees every gated module by default,
--   so this gives them a way to declutter their own nav (e.g. hide
--   Timeline if they don't use it) while keeping it live for members.
--
--   Stored as an array of module keys (matching access.ts GATED_MODULES)
--   on the existing one-row-per-user preferences table.
-- ============================================

ALTER TABLE user_ui_preferences
  ADD COLUMN IF NOT EXISTS hidden_modules JSONB DEFAULT '[]'::jsonb;
