-- ============================================
-- Weekly cash-flow (mirrors Melissa's weekly cash-flow spreadsheet).
--
-- A month is split into WEEKS. Each week has an opening balance (actual bank),
-- a checklist of PLANNED INCOME line items and a checklist of BILLS line items,
-- and an actual ending balance once the week closes. Worst-case and projected
-- endings are COMPUTED in the data layer, not stored.
--
--   cash_flow_weeks  — one row per (user, week_start).
--   cash_flow_lines  — the income/bill checklist items for a week.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS before
-- each CREATE, so it is safe to re-apply against a Supabase preview branch.
-- ============================================

-- ============================================
-- cash_flow_weeks
-- ============================================
CREATE TABLE IF NOT EXISTS cash_flow_weeks (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start             DATE NOT NULL,
  week_end               DATE NOT NULL,
  opening_balance        NUMERIC,
  actual_ending_balance  NUMERIC,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS cash_flow_weeks_user_idx
  ON cash_flow_weeks (user_id, week_start);

ALTER TABLE cash_flow_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cash flow weeks: owner read"   ON cash_flow_weeks;
DROP POLICY IF EXISTS "Cash flow weeks: owner insert" ON cash_flow_weeks;
DROP POLICY IF EXISTS "Cash flow weeks: owner update" ON cash_flow_weeks;
DROP POLICY IF EXISTS "Cash flow weeks: owner delete" ON cash_flow_weeks;

CREATE POLICY "Cash flow weeks: owner read"   ON cash_flow_weeks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow weeks: owner insert" ON cash_flow_weeks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Cash flow weeks: owner update" ON cash_flow_weeks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow weeks: owner delete" ON cash_flow_weeks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- cash_flow_lines
-- ============================================
CREATE TABLE IF NOT EXISTS cash_flow_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_id     UUID NOT NULL REFERENCES cash_flow_weeks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'bill')),
  line_date   DATE,
  source      TEXT NOT NULL DEFAULT '',
  amount      NUMERIC NOT NULL DEFAULT 0,
  settled     BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_flow_lines_week_idx ON cash_flow_lines (week_id);
CREATE INDEX IF NOT EXISTS cash_flow_lines_user_idx ON cash_flow_lines (user_id);

ALTER TABLE cash_flow_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cash flow lines: owner read"   ON cash_flow_lines;
DROP POLICY IF EXISTS "Cash flow lines: owner insert" ON cash_flow_lines;
DROP POLICY IF EXISTS "Cash flow lines: owner update" ON cash_flow_lines;
DROP POLICY IF EXISTS "Cash flow lines: owner delete" ON cash_flow_lines;

CREATE POLICY "Cash flow lines: owner read"   ON cash_flow_lines FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow lines: owner insert" ON cash_flow_lines FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Cash flow lines: owner update" ON cash_flow_lines FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Cash flow lines: owner delete" ON cash_flow_lines FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- updated_at triggers (shared function pattern used across the schema)
-- ============================================

CREATE OR REPLACE FUNCTION cash_flow_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_flow_weeks_updated_at ON cash_flow_weeks;
CREATE TRIGGER cash_flow_weeks_updated_at
  BEFORE UPDATE ON cash_flow_weeks
  FOR EACH ROW EXECUTE FUNCTION cash_flow_set_updated_at();

DROP TRIGGER IF EXISTS cash_flow_lines_updated_at ON cash_flow_lines;
CREATE TRIGGER cash_flow_lines_updated_at
  BEFORE UPDATE ON cash_flow_lines
  FOR EACH ROW EXECUTE FUNCTION cash_flow_set_updated_at();
