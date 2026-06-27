-- ============================================
-- Planner: per-user encrypted Google OAuth refresh tokens
--   Backend OAuth flow for Google Calendar. We store ONLY the
--   long-lived refresh token (encrypted at rest with AES-256-GCM via
--   GOOGLE_TOKEN_ENCRYPTION_SECRET). Short-lived access tokens are
--   minted fresh on demand inside the /api/google/token handler and
--   never persisted. Writes happen through the service role in the
--   OAuth callback; the browser never reads this table directly.
--
--   Per CLAUDE.md: idempotent so Supabase Preview Branching can
--   re-apply this migration without failing.
-- ============================================

CREATE TABLE IF NOT EXISTS user_google_tokens (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  refresh_token_nonce TEXT NOT NULL,
  refresh_token_auth_tag TEXT NOT NULL,
  scopes TEXT,
  google_email TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;

-- The browser only ever needs to know IF a row exists (and may delete
-- its own to disconnect). The refresh token itself is opaque ciphertext
-- and is only ever decrypted inside the service-role handlers.
DROP POLICY IF EXISTS "User google tokens: owner read" ON user_google_tokens;
CREATE POLICY "User google tokens: owner read"
ON user_google_tokens FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User google tokens: owner delete" ON user_google_tokens;
CREATE POLICY "User google tokens: owner delete"
ON user_google_tokens FOR DELETE USING (auth.uid() = user_id);
