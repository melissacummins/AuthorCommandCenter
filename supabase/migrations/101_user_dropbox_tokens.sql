-- ============================================
-- Content Creator: per-user encrypted Dropbox OAuth refresh tokens
--   Backend OAuth flow for the "Send to Dropbox" export option. Mirrors
--   user_google_tokens (079): we store ONLY the long-lived refresh
--   token, encrypted at rest with AES-256-GCM (same master secret as
--   Google, GOOGLE_TOKEN_ENCRYPTION_SECRET, but a different scrypt salt
--   so the derived keys are independent). Short-lived access tokens are
--   minted fresh on demand inside /api/dropbox/token and never
--   persisted. Writes happen through the service role in the OAuth
--   callback; the browser never reads the ciphertext columns for any
--   purpose other than existence checks.
--
--   Per CLAUDE.md: idempotent so Supabase Preview Branching can
--   re-apply this migration without failing.
-- ============================================

CREATE TABLE IF NOT EXISTS user_dropbox_tokens (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  refresh_token_nonce TEXT NOT NULL,
  refresh_token_auth_tag TEXT NOT NULL,
  dropbox_email TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_dropbox_tokens ENABLE ROW LEVEL SECURITY;

-- The browser only ever needs to know IF a row exists (and may delete
-- its own to disconnect). The refresh token itself is opaque ciphertext
-- and is only ever decrypted inside the service-role handlers.
DROP POLICY IF EXISTS "User dropbox tokens: owner read" ON user_dropbox_tokens;
CREATE POLICY "User dropbox tokens: owner read"
ON user_dropbox_tokens FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "User dropbox tokens: owner delete" ON user_dropbox_tokens;
CREATE POLICY "User dropbox tokens: owner delete"
ON user_dropbox_tokens FOR DELETE USING (auth.uid() = user_id);
