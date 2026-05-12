-- ============================================
-- SHOPIFY ORDERS INTEGRATION
-- Run this in your Supabase SQL Editor:
--   Dashboard > SQL Editor > New Query > Paste & Run
-- ============================================

-- ============================================
-- SHOPIFY SETTINGS (per-user credentials)
-- ============================================
CREATE TABLE shopify_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  store_url TEXT NOT NULL,
  access_token TEXT NOT NULL,
  default_location_id TEXT,
  default_location_name TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SHOPIFY ORDERS (synced order data)
-- ============================================
CREATE TABLE shopify_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  shopify_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,
  customer_name TEXT DEFAULT '',
  fulfillment_status TEXT DEFAULT '',
  financial_status TEXT DEFAULT '',
  location_id TEXT,
  location_name TEXT,
  total_price NUMERIC DEFAULT 0,
  line_items JSONB DEFAULT '[]',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, shopify_order_id)
);

-- ============================================
-- SHOPIFY SYNC LOG
-- ============================================
CREATE TABLE shopify_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  orders_synced INTEGER DEFAULT 0,
  date_range_start TEXT,
  date_range_end TEXT,
  location_name TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ENABLE RLS
-- ============================================
ALTER TABLE shopify_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_sync_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY['shopify_settings', 'shopify_orders', 'shopify_sync_log'])
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

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_shopify_settings_user ON shopify_settings(user_id);
CREATE INDEX idx_shopify_orders_user ON shopify_orders(user_id);
CREATE INDEX idx_shopify_orders_date ON shopify_orders(order_date);
CREATE INDEX idx_shopify_orders_location ON shopify_orders(location_id);
CREATE INDEX idx_shopify_orders_shopify_id ON shopify_orders(shopify_order_id);
CREATE INDEX idx_shopify_sync_log_user ON shopify_sync_log(user_id);
