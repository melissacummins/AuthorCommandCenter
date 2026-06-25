-- User-scoped tag palette for the "Special Add-ons" multi-select on Book
-- Specs. Each label has a chosen color so the same tag renders consistently
-- across every book. Tag membership for a given book still lives in
-- book_specs.special_addons (comma-separated labels).

CREATE TABLE IF NOT EXISTS addon_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_addon_tags_user ON addon_tags(user_id);

ALTER TABLE addon_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addon_tags_own ON addon_tags;
CREATE POLICY addon_tags_own ON addon_tags
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
