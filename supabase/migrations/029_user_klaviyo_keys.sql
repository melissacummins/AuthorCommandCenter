-- ============================================
-- Marketing: per-user encrypted Klaviyo API keys (BYOK)
--   Same shape as user_fal_keys (migration 025). Keys are encrypted
--   server-side with AES-256-GCM using a master secret from
--   KLAVIYO_KEY_ENCRYPTION_SECRET.
--
--   The client never sees ciphertext or plaintext after the initial
--   POST — only the server-side handler decrypts when calling Klaviyo
--   on the user's behalf.
-- ============================================

CREATE TABLE IF NOT EXISTS user_klaviyo_keys (
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  auth_tag       TEXT NOT NULL,
  key_hint       TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_klaviyo_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User klaviyo keys: owner read"   ON user_klaviyo_keys;
DROP POLICY IF EXISTS "User klaviyo keys: owner insert" ON user_klaviyo_keys;
DROP POLICY IF EXISTS "User klaviyo keys: owner update" ON user_klaviyo_keys;
DROP POLICY IF EXISTS "User klaviyo keys: owner delete" ON user_klaviyo_keys;

CREATE POLICY "User klaviyo keys: owner read"   ON user_klaviyo_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User klaviyo keys: owner insert" ON user_klaviyo_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User klaviyo keys: owner update" ON user_klaviyo_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User klaviyo keys: owner delete" ON user_klaviyo_keys FOR DELETE USING (auth.uid() = user_id);
