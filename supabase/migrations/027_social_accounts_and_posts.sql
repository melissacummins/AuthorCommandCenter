-- ============================================
-- Social Media: connected platform accounts and per-post stats.
--
-- A "social account" is one OAuth-connected handle on a platform
-- (Pinterest first, Meta/TikTok next). OAuth access + refresh tokens
-- are encrypted server-side with AES-256-GCM using a master secret
-- in SOCIAL_TOKEN_ENCRYPTION_SECRET; the ciphertext, nonce, and auth
-- tag live in this table. Clients never see decrypted tokens.
--
-- social_posts holds a per-post snapshot of the most recent metrics
-- we've pulled — one row per (account, external_post_id). We're not
-- storing time-series snapshots yet; if Melissa later wants
-- trend graphs we'll add a second table with daily rows.
-- ============================================

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  platform TEXT NOT NULL CHECK (platform IN ('pinterest','instagram','facebook','threads','tiktok')),
  external_account_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  profile_image_url TEXT,

  encrypted_access_token TEXT NOT NULL,
  access_token_nonce TEXT NOT NULL,
  access_token_auth_tag TEXT NOT NULL,

  encrypted_refresh_token TEXT,
  refresh_token_nonce TEXT,
  refresh_token_auth_tag TEXT,

  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',

  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,

  UNIQUE (user_id, platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS social_accounts_user_idx ON social_accounts (user_id);

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Social accounts: owner read" ON social_accounts;
CREATE POLICY "Social accounts: owner read"
ON social_accounts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Social accounts: owner delete" ON social_accounts;
CREATE POLICY "Social accounts: owner delete"
ON social_accounts FOR DELETE USING (auth.uid() = user_id);

-- Inserts and updates go through the server-side handlers (which hold
-- the encryption master key). RLS still requires the policies to exist
-- for the service role's writes to land.
DROP POLICY IF EXISTS "Social accounts: owner insert" ON social_accounts;
CREATE POLICY "Social accounts: owner insert"
ON social_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Social accounts: owner update" ON social_accounts;
CREATE POLICY "Social accounts: owner update"
ON social_accounts FOR UPDATE USING (auth.uid() = user_id);

-- ============================================

CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,

  platform TEXT NOT NULL,
  external_post_id TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  permalink TEXT,
  caption TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  media_type TEXT,

  -- Denormalized common metrics across platforms. Anything platform-
  -- specific (or that we haven't picked yet) goes in raw_metrics.
  impressions INTEGER,
  reach INTEGER,
  likes INTEGER,
  comments INTEGER,
  saves INTEGER,
  shares INTEGER,
  outbound_clicks INTEGER,
  video_views INTEGER,
  engagement INTEGER,

  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Optional link to a book in the catalog so we can answer
  -- "which post drove sales of which release."
  book_id UUID REFERENCES books(id) ON DELETE SET NULL,

  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (account_id, external_post_id)
);

CREATE INDEX IF NOT EXISTS social_posts_user_idx ON social_posts (user_id);
CREATE INDEX IF NOT EXISTS social_posts_user_platform_idx ON social_posts (user_id, platform);
CREATE INDEX IF NOT EXISTS social_posts_user_posted_at_idx ON social_posts (user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_book_idx ON social_posts (book_id) WHERE book_id IS NOT NULL;

ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Social posts: owner read" ON social_posts;
CREATE POLICY "Social posts: owner read"
ON social_posts FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Social posts: owner insert" ON social_posts;
CREATE POLICY "Social posts: owner insert"
ON social_posts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Updating book_id is the only thing the client ever needs to do
-- directly — the sync handler upserts everything else via service role.
DROP POLICY IF EXISTS "Social posts: owner update" ON social_posts;
CREATE POLICY "Social posts: owner update"
ON social_posts FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Social posts: owner delete" ON social_posts;
CREATE POLICY "Social posts: owner delete"
ON social_posts FOR DELETE USING (auth.uid() = user_id);
