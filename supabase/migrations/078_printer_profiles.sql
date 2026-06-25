-- Per-printer metadata (status + notes) so the user can mark printers as
-- Current/Rejected and filter the ranking view. Quotes themselves still live
-- in printer_quotes; this just attaches a status to the printer name.

CREATE TABLE IF NOT EXISTS printer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  printer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, printer)
);

CREATE INDEX IF NOT EXISTS idx_printer_profiles_user ON printer_profiles(user_id);

ALTER TABLE printer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS printer_profiles_own ON printer_profiles;
CREATE POLICY printer_profiles_own ON printer_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
