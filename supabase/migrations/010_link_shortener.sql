-- ============================================
-- Link Shortener Module
-- Run this in your Supabase SQL Editor:
--   Dashboard > SQL Editor > New Query > Paste & Run
-- ============================================

-- ============================================
-- SHORT LINKS
-- ============================================
CREATE TABLE IF NOT EXISTS short_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES short_links(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  label TEXT DEFAULT '',
  destination_url TEXT NOT NULL,
  channel TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  archived_at TIMESTAMPTZ,
  click_count INTEGER DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS short_links_slug_idx ON short_links(slug);
CREATE INDEX IF NOT EXISTS short_links_user_idx ON short_links(user_id);
CREATE INDEX IF NOT EXISTS short_links_parent_idx ON short_links(parent_id);

ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own links - select"
  ON short_links FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own links - insert"
  ON short_links FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own links - update"
  ON short_links FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users manage own links - delete"
  ON short_links FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_short_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS short_links_updated_at ON short_links;
CREATE TRIGGER short_links_updated_at
  BEFORE UPDATE ON short_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_short_links_updated_at();

-- ============================================
-- LINK CLICKS (analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS link_clicks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID REFERENCES short_links(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug TEXT NOT NULL,
  channel TEXT DEFAULT '',
  destination_url TEXT NOT NULL,
  referrer TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  device_type TEXT DEFAULT 'unknown',
  browser TEXT DEFAULT 'unknown',
  os TEXT DEFAULT 'unknown',
  country TEXT DEFAULT '',
  region TEXT DEFAULT '',
  city TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',
  language TEXT DEFAULT '',
  is_bot BOOLEAN DEFAULT FALSE,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS link_clicks_link_idx ON link_clicks(link_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS link_clicks_user_idx ON link_clicks(user_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS link_clicks_clicked_at_idx ON link_clicks(clicked_at DESC);

ALTER TABLE link_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own clicks"
  ON link_clicks FOR SELECT USING (auth.uid() = user_id);

-- Click inserts come from the redirect serverless function via service role,
-- which bypasses RLS. No public INSERT policy is granted.

-- ============================================
-- Increment click counter on short_links when a click is logged
-- ============================================
CREATE OR REPLACE FUNCTION public.bump_short_link_counter()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE short_links
    SET click_count = click_count + 1,
        last_clicked_at = NEW.clicked_at
    WHERE id = NEW.link_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS link_clicks_bump_counter ON link_clicks;
CREATE TRIGGER link_clicks_bump_counter
  AFTER INSERT ON link_clicks
  FOR EACH ROW EXECUTE FUNCTION public.bump_short_link_counter();
