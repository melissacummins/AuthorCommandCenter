-- ============================================
-- Author Command Center - Initial Schema
-- Run this in your Supabase SQL Editor:
--   Dashboard > SQL Editor > New Query > Paste & Run
-- ============================================

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- INVENTORY MODULE
-- ============================================
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  category TEXT DEFAULT 'Paperback' CHECK (category IN ('Paperback', 'Hardcover', 'Art Pack', 'Bundle', 'Book Box', 'Omnibus')),
  base_price NUMERIC DEFAULT 0,
  production_cost NUMERIC DEFAULT 0,
  shipping_cost NUMERIC DEFAULT 0,
  shipping_supplies_cost NUMERIC DEFAULT 0,
  pa_costs NUMERIC DEFAULT 0,
  qa_cost NUMERIC DEFAULT 0,
  handling_fee_add_on NUMERIC DEFAULT 0,
  tt_shop_price NUMERIC DEFAULT 0,
  free_shipping NUMERIC DEFAULT 0,
  book_stock INTEGER DEFAULT 0,
  books_purchased INTEGER DEFAULT 0,
  bundles_purchased INTEGER DEFAULT 0,
  purchased_via_bundles INTEGER DEFAULT 0,
  book_inventory INTEGER DEFAULT 0,
  bundles_inventory INTEGER DEFAULT 0,
  six_month_book_sales INTEGER DEFAULT 0,
  six_month_bundle_sales INTEGER DEFAULT 0,
  lead_time INTEGER DEFAULT 0,
  books_in_bundle TEXT DEFAULT '',
  bundles TEXT DEFAULT '',
  csv_avg_daily NUMERIC DEFAULT 0,
  csv_reorder_threshold NUMERIC DEFAULT 0,
  do_not_reorder BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  type TEXT CHECK (type IN ('add', 'subtract', 'csv_import', 'stock_reset')),
  inventory_type TEXT CHECK (inventory_type IN ('book', 'bundle')),
  quantity INTEGER DEFAULT 0,
  previous_value INTEGER DEFAULT 0,
  new_value INTEGER DEFAULT 0,
  source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  order_date TEXT,
  expected_dispatch TEXT,
  expected_arrival TEXT,
  actual_arrival TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'arrived')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE book_specs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID,
  printer TEXT DEFAULT '',
  trim_size TEXT DEFAULT '',
  page_count INTEGER DEFAULT 0,
  paper_type TEXT DEFAULT '',
  cover_type TEXT DEFAULT '',
  binding TEXT DEFAULT '',
  interior_color TEXT DEFAULT '',
  isbn TEXT DEFAULT '',
  weight NUMERIC DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE printer_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID,
  printer TEXT DEFAULT '',
  quantity INTEGER DEFAULT 0,
  unit_cost NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  turnaround TEXT DEFAULT '',
  shipping_estimate NUMERIC DEFAULT 0,
  quote_date TEXT,
  expires_date TEXT,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales_regions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  region TEXT NOT NULL,
  total_orders INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CROSS-SELL MODULE
-- ============================================
CREATE TABLE cross_sell_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year)
);

-- ============================================
-- BOOK TRACKER MODULE
-- ============================================
CREATE TABLE tracked_books (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  dev_cost NUMERIC DEFAULT 0,
  cost_breakdown JSONB DEFAULT '[]',
  launch_date TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paid_off')),
  cumulative_profit NUMERIC DEFAULT 0,
  payoff_date TEXT,
  months_to_payoff NUMERIC,
  final_profit NUMERIC,
  payoff_quarter TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quarterly_updates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  book_id UUID REFERENCES tracked_books(id) ON DELETE CASCADE NOT NULL,
  quarter TEXT NOT NULL,
  profit NUMERIC DEFAULT 0,
  date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PROFIT TRACK MODULE
-- ============================================
CREATE TABLE daily_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date TEXT NOT NULL,
  pnr_ads NUMERIC DEFAULT 0,
  contemp_ads NUMERIC DEFAULT 0,
  traffic_ads NUMERIC DEFAULT 0,
  misc_ads NUMERIC DEFAULT 0,
  shopify_rev NUMERIC DEFAULT 0,
  amazon_rev NUMERIC DEFAULT 0,
  d2d_rev NUMERIC DEFAULT 0,
  google_rev NUMERIC DEFAULT 0,
  kobo_rev NUMERIC DEFAULT 0,
  kobo_plus_rev NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE weekly_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start_date TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start_date)
);

CREATE TABLE order_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  multiplier NUMERIC DEFAULT 1,
  is_system BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE monthly_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month_key TEXT NOT NULL,
  source_id UUID REFERENCES order_sources(id) ON DELETE CASCADE,
  count INTEGER DEFAULT 0,
  snapshot_multiplier NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE monthly_page_reads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month_key TEXT NOT NULL,
  reads INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month_key)
);

CREATE TABLE book_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  series TEXT DEFAULT '',
  is_bundle BOOLEAN DEFAULT FALSE,
  included_book_ids JSONB DEFAULT '[]',
  language TEXT DEFAULT 'English',
  parent_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE book_daily_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date TEXT NOT NULL,
  book_id UUID REFERENCES book_products(id) ON DELETE CASCADE NOT NULL,
  pnr_ads NUMERIC DEFAULT 0,
  contemp_ads NUMERIC DEFAULT 0,
  traffic_ads NUMERIC DEFAULT 0,
  misc_ads NUMERIC DEFAULT 0,
  shopify_rev NUMERIC DEFAULT 0,
  amazon_rev NUMERIC DEFAULT 0,
  d2d_rev NUMERIC DEFAULT 0,
  google_rev NUMERIC DEFAULT 0,
  kobo_rev NUMERIC DEFAULT 0,
  kobo_plus_rev NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AD ALCHEMY MODULE
-- ============================================
CREATE TABLE ad_projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_cpr NUMERIC,
  target_roas NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE enriched_ads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES ad_projects(id) ON DELETE SET NULL,
  ad_name TEXT NOT NULL,
  ad_set_name TEXT DEFAULT '',
  date_created TEXT,
  spend NUMERIC DEFAULT 0,
  results INTEGER DEFAULT 0,
  cost_per_result NUMERIC DEFAULT 0,
  roas NUMERIC DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  cost_per_lpv NUMERIC DEFAULT 0,
  lpv_count INTEGER DEFAULT 0,
  purchase_value NUMERIC DEFAULT 0,
  purchase_rate_lpv NUMERIC DEFAULT 0,
  product_type TEXT DEFAULT '',
  hook TEXT DEFAULT '',
  media_type TEXT DEFAULT 'Unknown' CHECK (media_type IN ('Video', 'Image', 'Unknown')),
  media_number TEXT DEFAULT '',
  is_archived BOOLEAN DEFAULT FALSE,
  thumbnail_url TEXT,
  creative_name TEXT,
  notes TEXT,
  ad_copy TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FINSTREAM MODULE
-- ============================================
CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  original_description TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  category TEXT DEFAULT '',
  source TEXT DEFAULT '',
  type TEXT CHECK (type IN ('income', 'expense')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE category_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_string TEXT NOT NULL,
  target_category TEXT NOT NULL,
  type TEXT CHECK (type IN ('income', 'expense')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE manual_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vendor_name TEXT NOT NULL,
  match_string TEXT,
  frequency TEXT CHECK (frequency IN ('Monthly', 'Yearly', 'Weekly')),
  amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cash_flow_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

CREATE TABLE manual_history_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- KDP OPTIMIZER MODULE
-- ============================================
CREATE TABLE tropes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE kdp_books (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  series TEXT DEFAULT '',
  amazon_categories TEXT DEFAULT '',
  assigned_trope_ids JSONB DEFAULT '[]',
  selected_keyword_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE keywords (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  trope_id UUID REFERENCES tropes(id) ON DELETE CASCADE NOT NULL,
  search_volume INTEGER DEFAULT 0,
  search_volume_color TEXT DEFAULT '',
  competitive_score NUMERIC DEFAULT 0,
  competitive_score_color TEXT DEFAULT '',
  competitors INTEGER DEFAULT 0,
  avg_pages INTEGER DEFAULT 0,
  avg_price NUMERIC DEFAULT 0,
  avg_monthly_earnings NUMERIC DEFAULT 0,
  last_updated BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE printer_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_sell_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_page_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE enriched_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_history_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tropes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kdp_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES (users can only access their own data)
-- ============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'products', 'inventory_orders', 'purchase_orders', 'book_specs',
      'printer_quotes', 'sales_regions', 'cross_sell_reports', 'tracked_books',
      'quarterly_updates', 'daily_records', 'weekly_notes', 'order_sources',
      'monthly_orders', 'monthly_page_reads', 'book_products', 'book_daily_metrics',
      'ad_projects', 'enriched_ads', 'transactions', 'category_rules',
      'manual_subscriptions', 'cash_flow_notes', 'manual_history_entries',
      'tropes', 'kdp_books', 'keywords'
    ])
  LOOP
    EXECUTE format('CREATE POLICY "Users can view own %I" ON %I FOR SELECT USING (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can insert own %I" ON %I FOR INSERT WITH CHECK (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can update own %I" ON %I FOR UPDATE USING (auth.uid() = user_id)', tbl, tbl);
    EXECUTE format('CREATE POLICY "Users can delete own %I" ON %I FOR DELETE USING (auth.uid() = user_id)', tbl, tbl);
  END LOOP;
END $$;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_products_user ON products(user_id);
CREATE INDEX idx_inventory_orders_user ON inventory_orders(user_id);
CREATE INDEX idx_inventory_orders_product ON inventory_orders(product_id);
CREATE INDEX idx_purchase_orders_user ON purchase_orders(user_id);
CREATE INDEX idx_daily_records_user ON daily_records(user_id);
CREATE INDEX idx_daily_records_date ON daily_records(date);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_enriched_ads_user ON enriched_ads(user_id);
CREATE INDEX idx_enriched_ads_project ON enriched_ads(project_id);
CREATE INDEX idx_keywords_user ON keywords(user_id);
CREATE INDEX idx_keywords_trope ON keywords(trope_id);
CREATE INDEX idx_tracked_books_user ON tracked_books(user_id);
CREATE INDEX idx_book_daily_metrics_book ON book_daily_metrics(book_id);
CREATE INDEX idx_quarterly_updates_book ON quarterly_updates(book_id);
CREATE INDEX idx_cross_sell_reports_user ON cross_sell_reports(user_id);
CREATE INDEX idx_book_products_user ON book_products(user_id);
CREATE INDEX idx_monthly_orders_user ON monthly_orders(user_id);
