// Ordered list of user-scoped tables for backup/restore.
// CHILDREN (with foreign keys to siblings) must appear AFTER their parents in
// this list. We insert in this order on restore and delete in reverse.

export interface BackupTable {
  name: string;
  label: string;
  module: string;
}

export const BACKUP_TABLES: BackupTable[] = [
  // Inventory (products first — purchase_orders, book_specs, printer_quotes, inventory_orders all reference it)
  { name: 'products', label: 'Products', module: 'Inventory' },
  { name: 'inventory_orders', label: 'Inventory changes', module: 'Inventory' },
  { name: 'purchase_orders', label: 'Purchase orders', module: 'Inventory' },
  { name: 'book_specs', label: 'Book specs', module: 'Inventory' },
  { name: 'printer_quotes', label: 'Printer quotes', module: 'Inventory' },
  { name: 'sales_regions', label: 'Sales regions', module: 'Inventory' },
  { name: 'vendors', label: 'Vendors', module: 'Inventory' },

  // Cross-sell
  { name: 'cross_sell_reports', label: 'Cross-sell reports', module: 'Cross-Sell' },

  // Upsells
  { name: 'upsell_offers', label: 'Upsell offers', module: 'Upsells' },
  { name: 'upsell_events', label: 'Upsell view/click counters', module: 'Upsells' },
  { name: 'upsell_widget_settings', label: 'Upsell widget design', module: 'Upsells' },

  // Book Tracker (tracked_books first — quarterly_updates references it)
  { name: 'tracked_books', label: 'Tracked books', module: 'Book Tracker' },
  { name: 'quarterly_updates', label: 'Quarterly updates', module: 'Book Tracker' },

  // Profit (order_sources first — monthly_orders references it; book_products first — book_daily_metrics references it)
  { name: 'daily_records', label: 'Daily records', module: 'Profit' },
  { name: 'weekly_notes', label: 'Weekly notes', module: 'Profit' },
  { name: 'order_sources', label: 'Order sources', module: 'Profit' },
  { name: 'monthly_orders', label: 'Monthly orders', module: 'Profit' },
  { name: 'monthly_page_reads', label: 'Monthly page reads', module: 'Profit' },
  { name: 'book_products', label: 'Books & bundles', module: 'Profit' },
  { name: 'book_daily_metrics', label: 'Book daily metrics', module: 'Profit' },
  { name: 'profit_categories', label: 'Profit categories', module: 'Profit' },
  { name: 'user_ui_preferences', label: 'UI preferences', module: 'Settings' },

  // Ad Alchemy (ad_projects first — enriched_ads references it)
  { name: 'ad_projects', label: 'Ad projects', module: 'Ad Alchemy' },
  { name: 'enriched_ads', label: 'Enriched ads', module: 'Ad Alchemy' },

  // Transactions
  { name: 'transactions', label: 'Transactions', module: 'Transactions' },
  { name: 'category_rules', label: 'Category rules', module: 'Transactions' },
  { name: 'manual_subscriptions', label: 'Subscriptions', module: 'Transactions' },
  { name: 'cash_flow_notes', label: 'Cash flow notes', module: 'Transactions' },
  { name: 'manual_history_entries', label: 'Manual history', module: 'Transactions' },

  // KDP
  { name: 'tropes', label: 'Tropes', module: 'KDP Optimizer' },
  { name: 'kdp_books', label: 'KDP books', module: 'KDP Optimizer' },
  { name: 'keywords', label: 'Keywords', module: 'KDP Optimizer' },

  // Shopify
  { name: 'shopify_settings', label: 'Shopify settings', module: 'Shopify' },
  { name: 'shopify_orders', label: 'Shopify orders', module: 'Shopify' },
  { name: 'shopify_sync_log', label: 'Shopify sync log', module: 'Shopify' },
];

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  schema_version: number;
  exported_at: string;
  user_id: string;
  tables: Record<string, any[]>;
}
