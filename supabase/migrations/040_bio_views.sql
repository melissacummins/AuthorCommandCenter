-- ============================================
-- Bio page view tracking.
--   Counts views of a user's public bio page via a no-cache tracking
--   pixel (so edge-cached page loads still register). Inserts come from
--   the /api/bv pixel endpoint via the service role, so no INSERT policy
--   is granted; owners can read their own rows.
-- ============================================

CREATE TABLE IF NOT EXISTS bio_views (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  referrer    TEXT DEFAULT '',
  device_type TEXT DEFAULT 'unknown',
  country     TEXT DEFAULT '',
  is_bot      BOOLEAN DEFAULT FALSE,
  viewed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bio_views_user_idx ON bio_views(user_id, viewed_at DESC);

ALTER TABLE bio_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own bio views" ON bio_views;
CREATE POLICY "Users read own bio views"
  ON bio_views FOR SELECT USING (auth.uid() = user_id);
