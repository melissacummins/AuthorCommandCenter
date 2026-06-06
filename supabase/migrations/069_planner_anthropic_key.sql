-- ============================================
-- Planner: per-user encrypted Anthropic API keys (BYOK)
--   Same shape as user_klaviyo_keys (029) / user_fal_keys (025). Each
--   customer brings their own Anthropic API key; it's encrypted
--   server-side with AES-256-GCM using a master secret from
--   ANTHROPIC_KEY_ENCRYPTION_SECRET and only ever decrypted in the
--   /api/planner/ai handler when calling Claude on that user's behalf.
--
--   The client never sees ciphertext or plaintext after the initial
--   POST — only a short "…1234" hint for display.
-- ============================================

CREATE TABLE IF NOT EXISTS user_anthropic_keys (
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  auth_tag       TEXT NOT NULL,
  key_hint       TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_anthropic_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User anthropic keys: owner read"   ON user_anthropic_keys;
DROP POLICY IF EXISTS "User anthropic keys: owner insert" ON user_anthropic_keys;
DROP POLICY IF EXISTS "User anthropic keys: owner update" ON user_anthropic_keys;
DROP POLICY IF EXISTS "User anthropic keys: owner delete" ON user_anthropic_keys;

CREATE POLICY "User anthropic keys: owner read"   ON user_anthropic_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User anthropic keys: owner insert" ON user_anthropic_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User anthropic keys: owner update" ON user_anthropic_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User anthropic keys: owner delete" ON user_anthropic_keys FOR DELETE USING (auth.uid() = user_id);
