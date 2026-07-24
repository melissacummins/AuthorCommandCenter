-- ============================================
-- Pipeline (opportunity) preferences
--
--   user_ui_preferences.pipeline_prefs
--       Per-user config for the Catalog pipeline / opportunity engine: which
--       translation languages to propose and which whole suggestion types are
--       on. Shape (all keys optional; defaults applied client-side):
--         {
--           "translationLanguages": ["de","fr","es","it","pt"],
--           "types": { "translation": true, "audiobook": true,
--                      "paperback": true, "hardcover": true,
--                      "kdp": true, "arc": true }
--         }
--       Empty object '{}' means "use defaults". RLS is already owner-only on
--       user_ui_preferences, so no policy changes are needed here.
-- ============================================

ALTER TABLE user_ui_preferences
  ADD COLUMN IF NOT EXISTS pipeline_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
