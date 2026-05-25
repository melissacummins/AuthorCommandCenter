-- ============================================
-- Series pages.
--   A page that bundles several existing landing_pages (a book series)
--   into one shareable URL. page_ids is an ordered list of landing_pages
--   ids belonging to the same user; the public page renders each as a
--   cover + retailer-icon card. Shares the per-user slug namespace with
--   short_links and landing_pages.
-- Idempotent.
-- ============================================

CREATE TABLE IF NOT EXISTS series_pages (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug         TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  page_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  theme        TEXT NOT NULL DEFAULT 'classic',
  accent_color TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS series_pages_user_slug_unique ON series_pages(user_id, slug);
CREATE INDEX IF NOT EXISTS series_pages_user_idx ON series_pages(user_id);

ALTER TABLE series_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own series - select" ON series_pages;
CREATE POLICY "Users manage own series - select"
  ON series_pages FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own series - insert" ON series_pages;
CREATE POLICY "Users manage own series - insert"
  ON series_pages FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own series - update" ON series_pages;
CREATE POLICY "Users manage own series - update"
  ON series_pages FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users manage own series - delete" ON series_pages;
CREATE POLICY "Users manage own series - delete"
  ON series_pages FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_series_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS series_pages_updated_at ON series_pages;
CREATE TRIGGER series_pages_updated_at
  BEFORE UPDATE ON series_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_series_pages_updated_at();
