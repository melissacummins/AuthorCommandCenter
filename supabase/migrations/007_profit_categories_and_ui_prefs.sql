-- ============================================
-- PROFIT CATEGORIES + UI PREFERENCES
-- Makes the Profit module's ad/revenue categories user-customizable:
-- users can rename, hide, reorder, add, and delete custom entries. The
-- original 10 fixed columns on daily_records / book_daily_metrics stay
-- as-is (so historical data is never touched); they're now represented
-- as "built-in" categories with a legacy_column pointer. Custom
-- categories store amounts in a JSONB keyed by category id.
--
-- Also adds a user_ui_preferences row per user for toggling Profit tab
-- visibility (Book ROI, Weekly Summary, etc.).
--
-- Run this in Supabase SQL Editor.
-- ============================================

-- Categories table: one row per (user, category). Built-ins are seeded
-- lazily by the client on first load, so there's no server-side seed here.
CREATE TABLE IF NOT EXISTS profit_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ad', 'revenue')),
  -- For built-ins: the daily_records column this category reads/writes.
  -- NULL for user-added custom categories (stored in custom_amounts JSONB).
  legacy_column TEXT,
  sort_order INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  is_custom BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profit_categories_user ON profit_categories(user_id);

-- JSONB columns hold amounts for user-added custom categories, keyed by
-- category id. Built-in category values still live in the legacy columns.
ALTER TABLE daily_records
  ADD COLUMN IF NOT EXISTS custom_amounts JSONB DEFAULT '{}';

ALTER TABLE book_daily_metrics
  ADD COLUMN IF NOT EXISTS custom_amounts JSONB DEFAULT '{}';

-- One-row-per-user preferences. Currently just holds hidden Profit tabs
-- (e.g. ['books'] means the Book ROI tab is hidden in the UI).
CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  hidden_profit_tabs JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profit_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ui_preferences ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['profit_categories', 'user_ui_preferences'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Users can view own %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can view own %I" ON %I FOR SELECT USING (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Users can insert own %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can insert own %I" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Users can update own %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can update own %I" ON %I FOR UPDATE USING (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Users can delete own %I" ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can delete own %I" ON %I FOR DELETE USING (auth.uid() = user_id)', tbl, tbl);
  END LOOP;
END $$;
