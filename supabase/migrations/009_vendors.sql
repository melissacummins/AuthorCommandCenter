-- ============================================
-- VENDORS TABLE
-- Saved vendor list for purchase orders.
-- Run this in Supabase SQL Editor (new query).
-- ============================================

CREATE TABLE IF NOT EXISTS vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  contact_info TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own vendors" ON vendors;
CREATE POLICY "Users can view own vendors" ON vendors FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own vendors" ON vendors;
CREATE POLICY "Users can insert own vendors" ON vendors FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own vendors" ON vendors;
CREATE POLICY "Users can update own vendors" ON vendors FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own vendors" ON vendors;
CREATE POLICY "Users can delete own vendors" ON vendors FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vendors_user ON vendors(user_id);
