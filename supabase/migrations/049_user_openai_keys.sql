-- ============================================
-- Media: per-user encrypted OpenAI API keys (BYOK)
--   Same pattern as user_fal_keys — encrypted at rest with the same
--   FAL_KEY_ENCRYPTION_SECRET master, decrypted only inside serverless
--   handlers. When this key is configured, GPT Image 1 generations
--   route through OpenAI's API directly (much cheaper than via Fal).
--
--   Per CLAUDE.md: idempotent so Supabase Preview Branching can
--   re-apply this migration without failing.
-- ============================================

CREATE TABLE IF NOT EXISTS user_openai_keys (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_openai_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User openai keys: owner read" ON user_openai_keys;
CREATE POLICY "User openai keys: owner read"
ON user_openai_keys FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User openai keys: owner delete" ON user_openai_keys;
CREATE POLICY "User openai keys: owner delete"
ON user_openai_keys FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User openai keys: owner insert" ON user_openai_keys;
CREATE POLICY "User openai keys: owner insert"
ON user_openai_keys FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User openai keys: owner update" ON user_openai_keys;
CREATE POLICY "User openai keys: owner update"
ON user_openai_keys FOR UPDATE USING (auth.uid() = user_id);
