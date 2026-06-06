-- ============================================
-- Media: per-user encrypted Ideogram API keys (BYOK)
--   Same pattern as user_fal_keys / user_openai_keys — encrypted at
--   rest with the same FAL_KEY_ENCRYPTION_SECRET master, decrypted
--   only inside serverless handlers. When configured, the
--   ideogram-v3 / ideogram-v3-edit models route directly to
--   api.ideogram.ai instead of through Fal (Turbo mode is ~2× cheaper
--   than Fal's pass-through).
--
--   Per CLAUDE.md: idempotent so Supabase Preview Branching can
--   re-apply this migration without failing.
-- ============================================

CREATE TABLE IF NOT EXISTS user_ideogram_keys (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_ideogram_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User ideogram keys: owner read" ON user_ideogram_keys;
CREATE POLICY "User ideogram keys: owner read"
ON user_ideogram_keys FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User ideogram keys: owner delete" ON user_ideogram_keys;
CREATE POLICY "User ideogram keys: owner delete"
ON user_ideogram_keys FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User ideogram keys: owner insert" ON user_ideogram_keys;
CREATE POLICY "User ideogram keys: owner insert"
ON user_ideogram_keys FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User ideogram keys: owner update" ON user_ideogram_keys;
CREATE POLICY "User ideogram keys: owner update"
ON user_ideogram_keys FOR UPDATE USING (auth.uid() = user_id);
