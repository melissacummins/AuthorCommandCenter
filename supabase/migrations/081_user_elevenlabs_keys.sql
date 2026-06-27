-- ============================================
-- Audiobook: per-user encrypted ElevenLabs API keys (BYOK)
--   Same shape as user_anthropic_keys (069) / user_fal_keys (025). Each
--   customer brings their own ElevenLabs API key; it's encrypted
--   server-side with AES-256-GCM using a master secret from
--   ELEVENLABS_KEY_ENCRYPTION_SECRET and only ever decrypted in the
--   /api/audiobook handler when calling ElevenLabs on that user's behalf.
--
--   The client never sees ciphertext or plaintext after the initial
--   POST — only a short "…1234" hint for display.
-- ============================================

CREATE TABLE IF NOT EXISTS user_elevenlabs_keys (
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  auth_tag       TEXT NOT NULL,
  key_hint       TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_elevenlabs_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User elevenlabs keys: owner read"   ON user_elevenlabs_keys;
DROP POLICY IF EXISTS "User elevenlabs keys: owner insert" ON user_elevenlabs_keys;
DROP POLICY IF EXISTS "User elevenlabs keys: owner update" ON user_elevenlabs_keys;
DROP POLICY IF EXISTS "User elevenlabs keys: owner delete" ON user_elevenlabs_keys;

CREATE POLICY "User elevenlabs keys: owner read"   ON user_elevenlabs_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User elevenlabs keys: owner insert" ON user_elevenlabs_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User elevenlabs keys: owner update" ON user_elevenlabs_keys FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User elevenlabs keys: owner delete" ON user_elevenlabs_keys FOR DELETE USING (auth.uid() = user_id);
