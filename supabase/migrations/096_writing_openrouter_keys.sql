-- ============================================
-- Writing: per-user encrypted OpenRouter API keys (BYOK)
--   Cloned field-for-field from user_anthropic_keys (069). OpenRouter is the
--   Writing module's second AI provider — its single OpenAI-compatible
--   endpoint lets any customer of the (sellable) Command Center bring
--   whichever model they want with one key, not just Anthropic's.
--
--   Encrypted server-side with AES-256-GCM using the SAME master secret as
--   the Anthropic key (ANTHROPIC_KEY_ENCRYPTION_SECRET — a generic AES
--   secret despite the name; user_elevenlabs_keys and others already share
--   it), just a different salt. See api/writing/ai.ts.
-- ============================================

CREATE TABLE IF NOT EXISTS user_openrouter_keys (
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  auth_tag       TEXT NOT NULL,
  key_hint       TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_openrouter_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User openrouter keys: owner read"   ON user_openrouter_keys;
DROP POLICY IF EXISTS "User openrouter keys: owner insert" ON user_openrouter_keys;
DROP POLICY IF EXISTS "User openrouter keys: owner update" ON user_openrouter_keys;
DROP POLICY IF EXISTS "User openrouter keys: owner delete" ON user_openrouter_keys;

CREATE POLICY "User openrouter keys: owner read"   ON user_openrouter_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User openrouter keys: owner insert" ON user_openrouter_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User openrouter keys: owner update" ON user_openrouter_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User openrouter keys: owner delete" ON user_openrouter_keys FOR DELETE USING (auth.uid() = user_id);
