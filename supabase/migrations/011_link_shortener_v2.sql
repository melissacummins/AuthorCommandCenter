-- ============================================
-- Link Shortener v2:
--   - Folders
--   - Scheduling (starts_at / expires_at)
--   - Conversion tracking (manual + Shopify webhook + click_id attribution)
--   - QR generation has no schema needs
-- Run this in your Supabase SQL Editor:
--   Dashboard > SQL Editor > New Query > Paste & Run
-- ============================================

-- ============================================
-- LINK FOLDERS (flat list)
-- ============================================
CREATE TABLE IF NOT EXISTS link_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS link_folders_user_idx ON link_folders(user_id, sort_order);

ALTER TABLE link_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own folders - select" ON link_folders;
CREATE POLICY "Users manage own folders - select"
  ON link_folders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own folders - insert" ON link_folders;
CREATE POLICY "Users manage own folders - insert"
  ON link_folders FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own folders - update" ON link_folders;
CREATE POLICY "Users manage own folders - update"
  ON link_folders FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own folders - delete" ON link_folders;
CREATE POLICY "Users manage own folders - delete"
  ON link_folders FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- SHORT LINKS: scheduling, folders, branded page customization
-- ============================================
ALTER TABLE short_links
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES link_folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_redirect_url TEXT,
  ADD COLUMN IF NOT EXISTS conversion_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_value NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS short_links_folder_idx ON short_links(folder_id);
CREATE INDEX IF NOT EXISTS short_links_starts_idx ON short_links(starts_at);
CREATE INDEX IF NOT EXISTS short_links_expires_idx ON short_links(expires_at);

-- ============================================
-- LINK CLICKS: click_id (UUID stamped on each click for attribution)
-- ============================================
ALTER TABLE link_clicks
  ADD COLUMN IF NOT EXISTS click_id UUID DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS link_clicks_click_id_idx ON link_clicks(click_id);

-- ============================================
-- LINK CONVERSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS link_conversions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID REFERENCES short_links(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  click_id UUID,
  click_row_id UUID REFERENCES link_clicks(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'shopify_webhook', 'shopify_clickid', 'api')),
  external_ref TEXT,
  value NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT DEFAULT '',
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS link_conversions_link_idx ON link_conversions(link_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS link_conversions_user_idx ON link_conversions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS link_conversions_external_ref_idx ON link_conversions(external_ref);

-- Prevent duplicate Shopify orders being recorded as conversions twice
CREATE UNIQUE INDEX IF NOT EXISTS link_conversions_user_external_unique
  ON link_conversions(user_id, source, external_ref)
  WHERE external_ref IS NOT NULL AND source IN ('shopify_webhook', 'shopify_clickid');

ALTER TABLE link_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own conversions - select" ON link_conversions;
CREATE POLICY "Users manage own conversions - select"
  ON link_conversions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own conversions - insert" ON link_conversions;
CREATE POLICY "Users manage own conversions - insert"
  ON link_conversions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own conversions - update" ON link_conversions;
CREATE POLICY "Users manage own conversions - update"
  ON link_conversions FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own conversions - delete" ON link_conversions;
CREATE POLICY "Users manage own conversions - delete"
  ON link_conversions FOR DELETE USING (auth.uid() = user_id);

-- Roll up conversion totals onto the parent link
CREATE OR REPLACE FUNCTION public.bump_link_conversion_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE short_links
      SET conversion_count = conversion_count + 1,
          conversion_value = conversion_value + COALESCE(NEW.value, 0)
      WHERE id = NEW.link_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE short_links
      SET conversion_count = GREATEST(conversion_count - 1, 0),
          conversion_value = GREATEST(conversion_value - COALESCE(OLD.value, 0), 0)
      WHERE id = OLD.link_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE short_links
      SET conversion_value = conversion_value + COALESCE(NEW.value, 0) - COALESCE(OLD.value, 0)
      WHERE id = NEW.link_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS link_conversions_bump_totals ON link_conversions;
CREATE TRIGGER link_conversions_bump_totals
  AFTER INSERT OR UPDATE OR DELETE ON link_conversions
  FOR EACH ROW EXECUTE FUNCTION public.bump_link_conversion_totals();

-- ============================================
-- ATTRIBUTION SETTINGS (per-user webhook secret for Shopify HMAC)
-- ============================================
CREATE TABLE IF NOT EXISTS link_attribution_settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  shopify_webhook_secret TEXT,
  click_id_param TEXT DEFAULT 'click_id',
  attribution_window_minutes INTEGER DEFAULT 4320, -- 3 days
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE link_attribution_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own attribution settings - select" ON link_attribution_settings;
CREATE POLICY "Users manage own attribution settings - select"
  ON link_attribution_settings FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own attribution settings - insert" ON link_attribution_settings;
CREATE POLICY "Users manage own attribution settings - insert"
  ON link_attribution_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own attribution settings - update" ON link_attribution_settings;
CREATE POLICY "Users manage own attribution settings - update"
  ON link_attribution_settings FOR UPDATE USING (auth.uid() = user_id);
