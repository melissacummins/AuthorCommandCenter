-- ============================================
-- BookFunnel new-subscriber alert receiver.
--
-- BookFunnel's "BookFunnel API" integration fires a webhook (new_subscriber /
-- book_claimed) for every opt-in across all landing pages. We capture each one
-- here so the app can alert "you have new subscribers to export" — and, because
-- we don't yet know exactly what fields BookFunnel sends, we keep the FULL raw
-- payload so the first real events reveal what's available (email? page? book?).
--
--   bookfunnel_settings  - one row per user: the unguessable webhook secret the
--                          public endpoint validates, plus the last-seen time.
--   bookfunnel_events    - one row per received webhook: best-effort extracted
--                          fields + the raw payload + a "handled" flag.
--
-- The serverless webhook writes with the service-role key (bypasses RLS); the
-- app reads/updates under the owner's session via the policies below.
--
-- Per CLAUDE.md: idempotent so Supabase Preview Branching can re-apply it.
-- ============================================

CREATE TABLE IF NOT EXISTS bookfunnel_settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  webhook_secret TEXT NOT NULL,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bookfunnel_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BookFunnel settings: owner read" ON bookfunnel_settings;
CREATE POLICY "BookFunnel settings: owner read"
ON bookfunnel_settings FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel settings: owner insert" ON bookfunnel_settings;
CREATE POLICY "BookFunnel settings: owner insert"
ON bookfunnel_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel settings: owner update" ON bookfunnel_settings;
CREATE POLICY "BookFunnel settings: owner update"
ON bookfunnel_settings FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel settings: owner delete" ON bookfunnel_settings;
CREATE POLICY "BookFunnel settings: owner delete"
ON bookfunnel_settings FOR DELETE USING (auth.uid() = user_id);


CREATE TABLE IF NOT EXISTS bookfunnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT,                 -- 'new_subscriber' | 'book_claimed' | 'unknown'
  email TEXT,                      -- best-effort extraction (may be null)
  first_name TEXT,
  last_name TEXT,
  page TEXT,                       -- landing / opt-in page name, if present
  book TEXT,                       -- book title, if present
  occurred_at TIMESTAMPTZ,         -- timestamp from the payload, if present
  raw JSONB NOT NULL,              -- the full webhook payload, verbatim
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookfunnel_events_user_received_idx
  ON bookfunnel_events (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS bookfunnel_events_user_handled_idx
  ON bookfunnel_events (user_id, handled);

ALTER TABLE bookfunnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BookFunnel events: owner read" ON bookfunnel_events;
CREATE POLICY "BookFunnel events: owner read"
ON bookfunnel_events FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel events: owner insert" ON bookfunnel_events;
CREATE POLICY "BookFunnel events: owner insert"
ON bookfunnel_events FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel events: owner update" ON bookfunnel_events;
CREATE POLICY "BookFunnel events: owner update"
ON bookfunnel_events FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "BookFunnel events: owner delete" ON bookfunnel_events;
CREATE POLICY "BookFunnel events: owner delete"
ON bookfunnel_events FOR DELETE USING (auth.uid() = user_id);
