-- ============================================
-- Access control
--   app_members  : allowlist of who may use the app (pending/active/blocked)
--   app_modules  : per-tier rollout switches for each feature area
-- Payment is handled outside the app (community/Skool); this only governs
-- access. All statements are idempotent for Supabase Preview Branching.
-- ============================================

-- Admin check used by RLS. SECURITY DEFINER so it can read profiles.role
-- regardless of the caller's row-level policies (avoids policy recursion).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================
-- ALLOWLIST
-- ============================================
CREATE TABLE IF NOT EXISTS app_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
  plan TEXT NOT NULL DEFAULT 'alpha' CHECK (plan IN ('alpha', 'lifetime', 'admin')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT DEFAULT '',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_members ENABLE ROW LEVEL SECURITY;

-- A user can read their own membership row, matched on the email in their JWT.
DROP POLICY IF EXISTS "Members can view own membership" ON app_members;
CREATE POLICY "Members can view own membership" ON app_members
  FOR SELECT USING (lower(email) = lower(auth.jwt() ->> 'email'));

-- A signed-in user may create their own *pending* request — nothing else.
DROP POLICY IF EXISTS "Users can request access" ON app_members;
CREATE POLICY "Users can request access" ON app_members
  FOR INSERT WITH CHECK (
    lower(email) = lower(auth.jwt() ->> 'email')
    AND status = 'pending'
    AND plan = 'alpha'
    AND user_id = auth.uid()
  );

-- Admins manage everyone.
DROP POLICY IF EXISTS "Admins can view all members" ON app_members;
CREATE POLICY "Admins can view all members" ON app_members
  FOR SELECT USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can insert members" ON app_members;
CREATE POLICY "Admins can insert members" ON app_members
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update members" ON app_members;
CREATE POLICY "Admins can update members" ON app_members
  FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete members" ON app_members;
CREATE POLICY "Admins can delete members" ON app_members
  FOR DELETE USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_app_members_email ON app_members (lower(email));

-- ============================================
-- MODULE ROLLOUT SWITCHES
-- ============================================
CREATE TABLE IF NOT EXISTS app_modules (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  alpha_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lifetime_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_modules ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read which areas exist / are live.
DROP POLICY IF EXISTS "Authenticated can view modules" ON app_modules;
CREATE POLICY "Authenticated can view modules" ON app_modules
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can flip the switches.
DROP POLICY IF EXISTS "Admins can insert modules" ON app_modules;
CREATE POLICY "Admins can insert modules" ON app_modules
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update modules" ON app_modules;
CREATE POLICY "Admins can update modules" ON app_modules
  FOR UPDATE USING (public.is_admin());

-- Seed the catalog of feature areas (all off by default; turn on as you roll out).
INSERT INTO app_modules (key, label) VALUES
  ('catalog', 'Catalog'),
  ('timeline', 'Timeline'),
  ('book-tracker', 'Book Tracker'),
  ('profit-track', 'Profit'),
  ('finstream', 'Financials'),
  ('inventory', 'Inventory'),
  ('cross-sell', 'Cross-Sell Analyzer'),
  ('ad-alchemy', 'Ad Alchemy'),
  ('marketing', 'Marketing'),
  ('kdp-optimizer', 'KDP Optimizer'),
  ('links', 'Link Shortener'),
  ('arcs', 'ARCs'),
  ('media', 'Media'),
  ('social-media', 'Social Media')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- SEED THE OWNER
-- Make the owner an admin and an always-active member so the gate never
-- locks them out. (Other admins, if ever needed, are added the same way.)
-- ============================================
UPDATE public.profiles SET role = 'admin'
  WHERE lower(email) = 'melissa@melissacummins.com';

INSERT INTO app_members (email, status, plan, note, approved_at)
  VALUES ('melissa@melissacummins.com', 'active', 'admin', 'Owner', NOW())
  ON CONFLICT (email) DO UPDATE
    SET status = 'active', plan = 'admin';
