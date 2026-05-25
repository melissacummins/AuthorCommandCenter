-- ============================================
-- Book landing pages.
--   A standalone, themed page for one book at a clean slug on the author's
--   domain (e.g. read.author.com/forbidden), with auto-pulled cover/title/
--   description and a grid of retailer buttons. Shares the per-user slug
--   namespace with short_links (a name is one or the other), enforced at
--   create time + by the redirect handler's lookup order.
-- Idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS landing_pages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  source_url      TEXT NOT NULL DEFAULT '',
  buttons         JSONB NOT NULL DEFAULT '[]'::jsonb,
  theme           TEXT NOT NULL DEFAULT 'classic',
  accent_color    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_user_slug_unique ON landing_pages(user_id, slug);
CREATE INDEX IF NOT EXISTS landing_pages_user_idx ON landing_pages(user_id);

ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own landing pages - select" ON landing_pages;
CREATE POLICY "Users manage own landing pages - select"
  ON landing_pages FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own landing pages - insert" ON landing_pages;
CREATE POLICY "Users manage own landing pages - insert"
  ON landing_pages FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own landing pages - update" ON landing_pages;
CREATE POLICY "Users manage own landing pages - update"
  ON landing_pages FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own landing pages - delete" ON landing_pages;
CREATE POLICY "Users manage own landing pages - delete"
  ON landing_pages FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_landing_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS landing_pages_updated_at ON landing_pages;
CREATE TRIGGER landing_pages_updated_at
  BEFORE UPDATE ON landing_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_landing_pages_updated_at();
