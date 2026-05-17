-- ============================================
-- Media: per-user encrypted Fal.AI API keys (BYOK)
--   When this app is sold to other authors each user supplies their
--   own Fal key — we never see or pay for their generations. Keys are
--   encrypted server-side with AES-256-GCM using a master secret
--   stored in FAL_KEY_ENCRYPTION_SECRET; the ciphertext and nonce live
--   in this table.
--
--   RLS lets a user read their own row, but the client never decrypts
--   anything — only the server-side handlers do that on demand.
-- ============================================

CREATE TABLE IF NOT EXISTS user_fal_keys (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_fal_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User fal keys: owner read" ON user_fal_keys;
CREATE POLICY "User fal keys: owner read"
ON user_fal_keys FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User fal keys: owner delete" ON user_fal_keys;
CREATE POLICY "User fal keys: owner delete"
ON user_fal_keys FOR DELETE USING (auth.uid() = user_id);

-- Inserts and updates go through the server-side handler (which holds
-- the encryption master key), never directly from the client. We still
-- need permissive policies so the service role can write; the service
-- role bypasses RLS, but the policies must exist for the table to be
-- writeable when RLS is enabled.
DROP POLICY IF EXISTS "User fal keys: owner insert" ON user_fal_keys;
CREATE POLICY "User fal keys: owner insert"
ON user_fal_keys FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "User fal keys: owner update" ON user_fal_keys;
CREATE POLICY "User fal keys: owner update"
ON user_fal_keys FOR UPDATE USING (auth.uid() = user_id);
