// ============================================
// AUTH & USER
// ============================================
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'user';
  created_at: string;
  updated_at: string;
}

// ============================================
// INVENTORY MODULE
// ============================================
export type ProductCategory = 'Paperback' | 'Hardcover' | 'Art Pack' | 'Bundle' | 'Book Box' | 'Omnibus';

export interface Product {
  id: string;
  user_id: string;
  name: string;
  sku: string;
  category: ProductCategory;
  base_price: number;
  production_cost: number;
  shipping_cost: number;
  shipping_supplies_cost: number;
  pa_costs: number;
  qa_cost: number;
  handling_fee_add_on: number;
  tt_shop_price: number;
  free_shipping: number;
  book_stock: number;
  books_purchased: number;
  bundles_purchased: number;
  purchased_via_bundles: number;
  book_inventory: number;
  bundles_inventory: number;
  six_month_book_sales: number;
  six_month_bundle_sales: number;
  lead_time: number;
  books_in_bundle: string;
  bundles: string;
  csv_avg_daily: number;
  csv_reorder_threshold: number;
  do_not_reorder: boolean;
  shopify_inventory_item_id: string | null;
  shopify_variant_id: string | null;
  default_scratch_dent_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryOrder {
  id: string;
  user_id: string;
  product_id: string;
  type: 'add' | 'subtract' | 'csv_import' | 'stock_reset';
  inventory_type: 'book' | 'bundle';
  quantity: number;
  previous_value: number;
  new_value: number;
  source: string;
  notes: string;
  created_at: string;
}

export interface PurchaseOrder {
  id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  actual_quantity: number | null;
  scratch_dent_quantity: number;
  scratch_dent_product_id: string | null;
  order_date: string;
  expected_dispatch: string;
  expected_arrival: string;
  actual_arrival: string | null;
  status: 'pending' | 'arrived';
  po_number: string | null;
  vendor: string;
  notes: string;
  created_at: string;
}

export interface BookSpec {
  id: string;
  user_id: string;
  product_id: string;
  printer: string;
  trim_size: string;
  page_count: number;
  paper_type: string;
  cover_type: string;
  binding: string;
  interior_color: string;
  isbn: string;
  weight: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface PrinterQuote {
  id: string;
  user_id: string;
  product_id: string;
  printer: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  turnaround: string;
  shipping_estimate: number;
  quote_date: string;
  expires_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  user_id: string;
  name: string;
  contact_info: string;
  notes: string;
  created_at: string;
}

// ============================================
// CROSS-SELL MODULE
// ============================================
export interface RelatedProduct {
  name: string;
  count: number;
}

export interface ProductAnalysis {
  id: string;
  name: string;
  totalTransactions: number;
  relatedProducts: RelatedProduct[];
  topUpsell: RelatedProduct | null;
}

export interface CrossSellReport {
  id: string;
  user_id: string;
  year: string;
  data: ProductAnalysis[];
  created_at: string;
  updated_at: string;
}

// ============================================
// BOOK TRACKER MODULE
// ============================================
export interface CostItem {
  category: string;
  amount: number;
}

export interface QuarterlyUpdate {
  id: string;
  user_id: string;
  book_id: string;
  quarter: string;
  profit: number;
  date: string;
  created_at: string;
}

export interface TrackedBook {
  id: string;
  user_id: string;
  title: string;
  dev_cost: number;
  cost_breakdown: CostItem[];
  launch_date: string | null;
  status: 'active' | 'paid_off';
  cumulative_profit: number;
  payoff_date: string | null;
  months_to_payoff: number | null;
  final_profit: number | null;
  payoff_quarter: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// PROFIT TRACK MODULE
// ============================================
export interface DailyRecord {
  id: string;
  user_id: string;
  date: string;
  pnr_ads: number;
  contemp_ads: number;
  traffic_ads: number;
  misc_ads: number;
  shopify_rev: number;
  amazon_rev: number;
  d2d_rev: number;
  google_rev: number;
  kobo_rev: number;
  kobo_plus_rev: number;
  created_at: string;
  updated_at: string;
}

export interface WeeklyNote {
  id: string;
  user_id: string;
  week_start_date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface OrderSource {
  id: string;
  user_id: string;
  name: string;
  multiplier: number;
  is_system: boolean;
  is_archived: boolean;
  created_at: string;
}

export interface MonthlyOrderEntry {
  id: string;
  user_id: string;
  month_key: string;
  source_id: string;
  count: number;
  snapshot_multiplier: number | null;
  created_at: string;
}

export interface MonthlyPageReads {
  id: string;
  user_id: string;
  month_key: string;
  reads: number;
  created_at: string;
}

export interface BookProduct {
  id: string;
  user_id: string;
  title: string;
  series: string;
  is_bundle: boolean;
  included_book_ids: string[];
  language: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookDailyMetric {
  id: string;
  user_id: string;
  date: string;
  book_id: string;
  pnr_ads: number;
  contemp_ads: number;
  traffic_ads: number;
  misc_ads: number;
  shopify_rev: number;
  amazon_rev: number;
  d2d_rev: number;
  google_rev: number;
  kobo_rev: number;
  kobo_plus_rev: number;
  created_at: string;
}

// ============================================
// AD ALCHEMY MODULE
// ============================================
export interface AdProject {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_cpr: number | null;
  target_roas: number | null;
  created_at: string;
  updated_at: string;
}

export type MediaType = 'Video' | 'Image' | 'Unknown';

export interface EnrichedAd {
  id: string;
  user_id: string;
  project_id: string | null;
  ad_name: string;
  ad_set_name: string;
  date_created: string;
  spend: number;
  results: number;
  cost_per_result: number;
  roas: number;
  ctr: number;
  cost_per_lpv: number;
  lpv_count: number;
  purchase_value: number;
  purchase_rate_lpv: number;
  product_type: string;
  hook: string;
  media_type: MediaType;
  media_number: string;
  is_archived: boolean;
  thumbnail_url: string | null;
  creative_name: string | null;
  notes: string | null;
  ad_copy: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// FINSTREAM MODULE
// ============================================
export interface Transaction {
  id: string;
  user_id: string;
  date: string;
  description: string;
  original_description: string;
  amount: number;
  category: string;
  source: string;
  type: 'income' | 'expense';
  created_at: string;
}

export interface CategoryRule {
  id: string;
  user_id: string;
  match_string: string;
  target_category: string;
  type: 'income' | 'expense' | null;
  created_at: string;
}

export interface ManualSubscription {
  id: string;
  user_id: string;
  vendor_name: string;
  match_string: string | null;
  frequency: 'Monthly' | 'Yearly' | 'Weekly';
  amount: number | null;
  created_at: string;
}

export interface CashFlowNote {
  id: string;
  user_id: string;
  month: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ManualHistoryEntry {
  id: string;
  user_id: string;
  month: string;
  amount: number;
  description: string;
  created_at: string;
}

// ============================================
// KDP OPTIMIZER MODULE
// ============================================
export interface Trope {
  id: string;
  user_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface KdpBook {
  id: string;
  user_id: string;
  title: string;
  subtitle: string | null;
  series: string;
  amazon_categories: string;
  assigned_trope_ids: string[];
  selected_keyword_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface KdpKeyword {
  id: string;
  user_id: string;
  text: string;
  trope_id: string;
  search_volume: number;
  search_volume_color: string;
  competitive_score: number;
  competitive_score_color: string;
  competitors: number;
  avg_pages: number;
  avg_price: number;
  avg_monthly_earnings: number;
  last_updated: number | null;
  created_at: string;
}

// ============================================
// MARKETING MODULE — ADS
// ============================================
export interface BookAnalysis {
  id: string;
  user_id: string;
  book_title: string;
  series: string | null;
  subgenre: string;
  themes: string[];
  tropes: string[];
  character_dynamics: string[];
  key_scenes: string[];
  tone_keywords: string[];
  heat_level: string | null;
  comp_authors: CompAuthor[];
  reader_avatars: ReaderAvatar[];
  created_at: string;
  updated_at: string;
}

export interface CompAuthor {
  name: string;
  relevance: string;
  source: string | null;
}

export interface ReaderAvatar {
  id: string;
  name: string;
  description: string;
  desires: string[];
  tropes_searched: string[];
  framework: string;
}

export type CreativeType = 'image' | 'video' | 'slideshow';
export type CreativeSource = 'upload' | 'dropbox' | 'generated';

export interface AdCreative {
  id: string;
  user_id: string;
  book_analysis_id: string | null;
  name: string;
  type: CreativeType;
  source: CreativeSource;
  file_url: string | null;
  thumbnail_url: string | null;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AdHook {
  id: string;
  user_id: string;
  book_analysis_id: string | null;
  text: string;
  hook_type: 'quote' | 'declarative' | 'mini_story';
  source: 'manuscript' | 'original';
  source_context: string | null;
  character: string | null;
  scene_reference: string | null;
  is_favorite: boolean;
  created_at: string;
}

export interface AdCopySet {
  id: string;
  user_id: string;
  book_analysis_id: string | null;
  creative_id: string | null;
  hook_id: string | null;
  name: string;
  status: 'draft' | 'final' | 'active';
  primary_text_variations: PrimaryTextVariation[];
  headlines: Headline[];
  seo_description: SEODescription | null;
  trope_list: string;
  social_proof: string;
  cta: string;
  created_at: string;
  updated_at: string;
}

export interface PrimaryTextVariation {
  id: string;
  avatar_name: string;
  framework: string;
  hook_text: string;
  expansion: string;
}

export interface Headline {
  id: string;
  text: string;
  char_count: number;
  purpose: 'genre_signal' | 'heroine_power' | 'hero_devotion' | 'scene_tension' | 'trope_signal';
}

export interface SEODescription {
  payload: string;
  comps: string;
  vibe_stack: string;
  keyword_sink: string;
}

export interface ReelScript {
  id: string;
  user_id: string;
  book_analysis_id: string | null;
  creative_id: string | null;
  hook_id: string | null;
  name: string;
  total_duration: number;
  segments: ReelSegment[];
  created_at: string;
  updated_at: string;
}

export interface ReelSegment {
  id: string;
  order: number;
  start_time: number;
  end_time: number;
  text: string;
  notes: string | null;
}

// ============================================
// MARKETING MODULE — SOCIAL MEDIA
// ============================================
export interface SocialMediaPost {
  id: string;
  user_id: string;
  book_analysis_id: string | null;
  ad_copy_set_id: string | null;
  platform: 'instagram' | 'facebook' | 'tiktok' | 'pinterest';
  content_type: 'reel' | 'static' | 'carousel' | 'story';
  original_text: string;
  adapted_text: string;
  algospeak_applied: boolean;
  hashtags: string[];
  scheduled_date: string | null;
  status: 'draft' | 'scheduled' | 'posted';
  created_at: string;
  updated_at: string;
}

// ============================================
// SHOPIFY ORDERS MODULE
// ============================================
export interface ShopifySettings {
  id: string;
  user_id: string;
  store_url: string;
  access_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  default_location_id: string | null;
  default_location_name: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyLocation {
  id: number;
  name: string;
  address1: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  active: boolean;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  sku: string;
  quantity: number;
  price: string;
  variant_title: string | null;
  product_id: number | null;
  variant_id: number | null;
}

export interface ShopifyOrder {
  id: string;
  user_id: string;
  shopify_order_id: string;
  order_number: string;
  order_date: string;
  customer_name: string;
  fulfillment_status: string;
  financial_status: string;
  location_id: string | null;
  location_name: string | null;
  total_price: number;
  line_items: ShopifyLineItem[];
  synced_at: string;
}

export interface ShopifySyncLog {
  id: string;
  user_id: string;
  sync_type: string;
  status: string;
  orders_synced: number;
  date_range_start: string | null;
  date_range_end: string | null;
  location_name: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SkuMatch {
  sku: string;
  productName: string;
  productId: string;
  category: string;
  totalQuantity: number;
  orderCount: number;
  isBundle: boolean;
}

// ============================================
// MODULE DEFINITIONS
// ============================================
export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  path: string;
  color: string;
}
