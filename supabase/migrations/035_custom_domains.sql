-- ============================================
-- Custom domains for the link shortener + bio page
--   custom_domains : maps an incoming web host -> the user who owns it
--   per-user slugs : two members can each own /preorder without colliding
--   bio title/sub  : was global env vars, now per-user
-- Backward compatible: the owner's existing domain is seeded so current
-- links keep resolving exactly as before. Idempotent for Preview Branching.
-- Depends on public.is_admin() from migration 034.
-- ============================================

CREATE TABLE IF NOT EXISTS custom_domains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_domains_user_idx ON custom_domains(user_id);

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

-- Users manage their own domains, but cannot mark themselves verified
-- (that's an admin action once DNS is pointed and the domain is attached).
DROP POLICY IF EXISTS "Users view own domains" ON custom_domains;
CREATE POLICY "Users view own domains" ON custom_domains
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users add own domains" ON custom_domains;
CREATE POLICY "Users add own domains" ON custom_domains
  FOR INSERT WITH CHECK (auth.uid() = user_id AND verified = FALSE);
DROP POLICY IF EXISTS "Users delete own domains" ON custom_domains;
CREATE POLICY "Users delete own domains" ON custom_domains
  FOR DELETE USING (auth.uid() = user_id);

-- Admins verify, set primary, and clean up.
DROP POLICY IF EXISTS "Admins view all domains" ON custom_domains;
CREATE POLICY "Admins view all domains" ON custom_domains
  FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "Admins update domains" ON custom_domains;
CREATE POLICY "Admins update domains" ON custom_domains
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins delete domains" ON custom_domains;
CREATE POLICY "Admins delete domains" ON custom_domains
  FOR DELETE USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_custom_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custom_domains_updated_at ON custom_domains;
CREATE TRIGGER custom_domains_updated_at
  BEFORE UPDATE ON custom_domains
  FOR EACH ROW EXECUTE FUNCTION public.touch_custom_domains_updated_at();

-- Per-user bio heading + tagline (previously the BIO_TITLE/BIO_SUBTITLE env vars).
ALTER TABLE bio_settings ADD COLUMN IF NOT EXISTS bio_title TEXT;
ALTER TABLE bio_settings ADD COLUMN IF NOT EXISTS bio_subtitle TEXT;

-- Slugs become unique PER USER instead of globally, so each member has their
-- own namespace. Safe now (single user => no collisions to resolve).
ALTER TABLE short_links DROP CONSTRAINT IF EXISTS short_links_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS short_links_user_slug_unique ON short_links(user_id, slug);

-- Seed the owner's existing domain so live links keep resolving unchanged.
INSERT INTO custom_domains (user_id, domain, verified, is_primary)
  SELECT id, 'read.melissacummins.com', TRUE, TRUE
  FROM public.profiles
  WHERE lower(email) = 'melissa@melissacummins.com'
  ON CONFLICT (domain) DO NOTHING;
