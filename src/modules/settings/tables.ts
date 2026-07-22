// Ordered list of user-scoped tables for backup/restore.
//
// ORDERING RULE: children (with a foreign key to another table in this list)
// must appear AFTER their parents. We INSERT in this order on restore and
// DELETE in reverse. The order below is a verified topological sort of every
// user-scoped table's foreign-key graph (no cycles), so a full restore never
// violates a constraint.
//
// WHAT'S INCLUDED: every table in the public schema that carries a `user_id`
// column — i.e. everything that belongs to a user — EXCEPT:
//   - the OAuth-token / API-key tables (user_google_tokens, user_dropbox_tokens,
//     user_*_keys). Those hold encrypted secrets, are re-established by simply
//     reconnecting the integration, and must never travel inside a portable
//     backup file. Deliberately excluded.
//   - app_members (access-control; its user_id is nullable and rewriting it on
//     a single-user restore would be semantically wrong).
//
// Storage-bucket FILES (book covers, audiobook audio, generated media, bio
// logos) are binary, not rows, so they are NOT part of this JSON. The cloud
// backup path (src/lib/cloudBackup.ts) captures those separately alongside the
// data.json this list produces.

export interface BackupTable {
  name: string;
  label: string;
  module: string;
}

export const BACKUP_TABLES: BackupTable[] = [
  // ── Ad Alchemy ──────────────────────────────────────────────────────────
  { name: 'ad_projects', label: 'Ad projects', module: 'Ad Alchemy' },

  // ── Inventory (roots) ───────────────────────────────────────────────────
  { name: 'addon_tags', label: 'Add-on tags', module: 'Inventory' },

  // ── ARCs (arc_readers before arc_reader_books) ──────────────────────────
  { name: 'arc_readers', label: 'ARC readers', module: 'ARCs' },

  // ── Links & Bio (bio settings/analytics roots) ──────────────────────────
  { name: 'bio_settings', label: 'Bio settings', module: 'Links & Bio' },
  { name: 'bio_views', label: 'Bio views', module: 'Links & Bio' },

  // ── Profit (book_products before book_daily_metrics) ────────────────────
  { name: 'book_products', label: 'Books & bundles', module: 'Profit' },
  { name: 'book_daily_metrics', label: 'Book daily metrics', module: 'Profit' },

  // ── Inventory ───────────────────────────────────────────────────────────
  { name: 'book_specs', label: 'Book specs', module: 'Inventory' },

  // ── Transactions ────────────────────────────────────────────────────────
  { name: 'cash_flow_notes', label: 'Cash flow notes', module: 'Transactions' },
  { name: 'category_rules', label: 'Category rules', module: 'Transactions' },

  // ── Content Creator (settings root) ─────────────────────────────────────
  { name: 'content_model_settings', label: 'Content model settings', module: 'Content Creator' },

  // ── Cross-Sell ──────────────────────────────────────────────────────────
  { name: 'cross_sell_reports', label: 'Cross-sell reports', module: 'Cross-Sell' },

  // ── Links & Bio ─────────────────────────────────────────────────────────
  { name: 'custom_domains', label: 'Custom domains', module: 'Links & Bio' },

  // ── Profit ──────────────────────────────────────────────────────────────
  { name: 'daily_records', label: 'Daily records', module: 'Profit' },

  // ── Ad Alchemy (enriched_ads → ad_projects) ─────────────────────────────
  { name: 'enriched_ads', label: 'Enriched ads', module: 'Ad Alchemy' },

  // ── Links & Bio ─────────────────────────────────────────────────────────
  { name: 'link_attribution_settings', label: 'Link attribution settings', module: 'Links & Bio' },
  { name: 'link_folders', label: 'Link folders', module: 'Links & Bio' },

  // ── Transactions ────────────────────────────────────────────────────────
  { name: 'manual_history_entries', label: 'Manual history', module: 'Transactions' },
  { name: 'manual_subscriptions', label: 'Subscriptions', module: 'Transactions' },

  // ── Media (collections/presets before generations) ──────────────────────
  { name: 'media_collections', label: 'Media collections', module: 'Media' },
  { name: 'media_custom_models', label: 'Media custom models', module: 'Media' },
  { name: 'media_settings', label: 'Media settings', module: 'Media' },
  { name: 'media_style_presets', label: 'Media style presets', module: 'Media' },
  { name: 'media_generations', label: 'Media generations', module: 'Media' },

  // ── Content Creator ─────────────────────────────────────────────────────
  { name: 'model_favorites', label: 'Model favorites', module: 'Content Creator' },

  // ── Profit ──────────────────────────────────────────────────────────────
  { name: 'monthly_page_reads', label: 'Monthly page reads', module: 'Profit' },

  // ── Catalog (newsletter events) ─────────────────────────────────────────
  { name: 'newsletter_events', label: 'Newsletter events', module: 'Catalog' },

  // ── Profit (order_sources before monthly_orders) ────────────────────────
  { name: 'order_sources', label: 'Order sources', module: 'Profit' },
  { name: 'monthly_orders', label: 'Monthly orders', module: 'Profit' },

  // ── Catalog (pen_names is a root parent of books/planner/hooks) ─────────
  { name: 'pen_names', label: 'Pen names', module: 'Catalog' },
  { name: 'books', label: 'Catalog books', module: 'Catalog' },

  // ── ARCs (arc_reader_books → arc_readers, books) ────────────────────────
  { name: 'arc_reader_books', label: 'ARC reader books', module: 'ARCs' },

  // ── Audiobook (project → chapters → segments) ───────────────────────────
  { name: 'audiobook_projects', label: 'Audiobook projects', module: 'Audiobook' },
  { name: 'audiobook_chapters', label: 'Audiobook chapters', module: 'Audiobook' },
  { name: 'audiobook_segments', label: 'Audiobook segments', module: 'Audiobook' },

  // ── Book Tracker ────────────────────────────────────────────────────────
  { name: 'book_opportunity_decisions', label: 'Opportunity decisions', module: 'Book Tracker' },

  // ── Writing ─────────────────────────────────────────────────────────────
  { name: 'book_word_logs', label: 'Book word logs', module: 'Writing' },

  // ── Content Creator ─────────────────────────────────────────────────────
  { name: 'hook_playbook_entries', label: 'Hook playbook entries', module: 'Content Creator' },

  // ── KDP (kdp_books → books) ─────────────────────────────────────────────
  { name: 'kdp_books', label: 'KDP books', module: 'KDP Optimizer' },

  // ── Writing (manuscripts → books; children after) ───────────────────────
  { name: 'manuscripts', label: 'Manuscripts', module: 'Writing' },

  // ── Content Creator (hooks → manuscripts/books; creatives/scans after) ──
  { name: 'content_hooks', label: 'Content hooks', module: 'Content Creator' },
  { name: 'content_creatives', label: 'Content creatives', module: 'Content Creator' },
  { name: 'content_scans', label: 'Content scans', module: 'Content Creator' },

  // ── Writing (manuscript children) ───────────────────────────────────────
  { name: 'manuscript_chapters', label: 'Manuscript chapters', module: 'Writing' },
  { name: 'manuscript_chats', label: 'Manuscript chats', module: 'Writing' },
  { name: 'manuscript_revisions', label: 'Manuscript revisions', module: 'Writing' },
  { name: 'manuscript_word_logs', label: 'Manuscript word logs', module: 'Writing' },

  // ── Catalog (newsletter_event_books → newsletter_events, books) ─────────
  { name: 'newsletter_event_books', label: 'Newsletter event books', module: 'Catalog' },

  // ── Planner (blocks/notes before tasks; tasks before sessions) ──────────
  { name: 'planner_day_notes', label: 'Planner day notes', module: 'Planner' },
  { name: 'planner_notes', label: 'Planner notes', module: 'Planner' },
  { name: 'planner_settings', label: 'Planner settings', module: 'Planner' },
  { name: 'planner_time_blocks', label: 'Planner time blocks', module: 'Planner' },
  { name: 'planner_tasks', label: 'Planner tasks', module: 'Planner' },
  { name: 'planner_time_sessions', label: 'Planner time sessions', module: 'Planner' },

  // ── Content Creator ─────────────────────────────────────────────────────
  { name: 'playbook_rules', label: 'Playbook rules', module: 'Content Creator' },

  // ── Inventory ───────────────────────────────────────────────────────────
  { name: 'printer_profiles', label: 'Printer profiles', module: 'Inventory' },
  { name: 'printer_quotes', label: 'Printer quotes', module: 'Inventory' },
  { name: 'products', label: 'Products', module: 'Inventory' },
  { name: 'inventory_orders', label: 'Inventory changes', module: 'Inventory' },

  // ── Profit ──────────────────────────────────────────────────────────────
  { name: 'profit_categories', label: 'Profit categories', module: 'Profit' },

  // ── Catalog ─────────────────────────────────────────────────────────────
  { name: 'promotions', label: 'Promotions', module: 'Catalog' },

  // ── Inventory ───────────────────────────────────────────────────────────
  { name: 'purchase_orders', label: 'Purchase orders', module: 'Inventory' },
  { name: 'sales_regions', label: 'Sales regions', module: 'Inventory' },

  // ── Links & Bio (series_pages → landing_pages → bio_blocks) ─────────────
  { name: 'series_pages', label: 'Series pages', module: 'Links & Bio' },
  { name: 'landing_pages', label: 'Landing pages', module: 'Links & Bio' },
  { name: 'bio_blocks', label: 'Bio blocks', module: 'Links & Bio' },

  // ── Shopify ─────────────────────────────────────────────────────────────
  { name: 'shopify_orders', label: 'Shopify orders', module: 'Shopify' },
  { name: 'shopify_settings', label: 'Shopify settings', module: 'Shopify' },
  { name: 'shopify_sync_log', label: 'Shopify sync log', module: 'Shopify' },

  // ── Links & Bio (short_links → link_folders; clicks/conversions after) ──
  { name: 'short_links', label: 'Short links', module: 'Links & Bio' },
  { name: 'link_clicks', label: 'Link clicks', module: 'Links & Bio' },
  { name: 'link_conversions', label: 'Link conversions', module: 'Links & Bio' },

  // ── Social Media (social_accounts before social_posts) ──────────────────
  { name: 'social_accounts', label: 'Social accounts', module: 'Social Media' },
  { name: 'social_posts', label: 'Social posts', module: 'Social Media' },

  // ── Book Tracker (tracked_books → books; quarterly_updates after) ───────
  { name: 'tracked_books', label: 'Tracked books', module: 'Book Tracker' },
  { name: 'quarterly_updates', label: 'Quarterly updates', module: 'Book Tracker' },

  // ── Transactions ────────────────────────────────────────────────────────
  { name: 'transactions', label: 'Transactions', module: 'Transactions' },

  // ── KDP (tropes before keywords) ────────────────────────────────────────
  { name: 'tropes', label: 'Tropes', module: 'KDP Optimizer' },
  { name: 'keywords', label: 'Keywords', module: 'KDP Optimizer' },

  // ── Upsells ─────────────────────────────────────────────────────────────
  { name: 'upsell_events', label: 'Upsell view/click counters', module: 'Upsells' },
  { name: 'upsell_offers', label: 'Upsell offers', module: 'Upsells' },
  { name: 'upsell_widget_settings', label: 'Upsell widget design', module: 'Upsells' },

  // ── Content Creator ─────────────────────────────────────────────────────
  { name: 'user_banned_word_optouts', label: 'Banned word opt-outs', module: 'Content Creator' },

  // ── Settings ────────────────────────────────────────────────────────────
  { name: 'user_ui_preferences', label: 'UI preferences', module: 'Settings' },

  // ── Inventory ───────────────────────────────────────────────────────────
  { name: 'vendors', label: 'Vendors', module: 'Inventory' },

  // ── Profit ──────────────────────────────────────────────────────────────
  { name: 'weekly_notes', label: 'Weekly notes', module: 'Profit' },

  // ── Planner ─────────────────────────────────────────────────────────────
  { name: 'weekly_resets', label: 'Weekly resets', module: 'Planner' },
];

// Bumped 1 → 2 when coverage expanded from 35 tables to the full user-scoped
// set (adds Writing, Planner, Catalog, ARCs, Audiobook, Media, Social, Links &
// Bio, and more). Older (v1) backup files are still restorable — restore
// tolerates tables a file doesn't contain — so this bump does not orphan them.
export const BACKUP_SCHEMA_VERSION = 2;

// The Supabase Storage buckets whose files are captured by the cloud backup.
// Every object is pathed under `<user_id>/…`, so a user's files list cleanly.
export interface StorageBucket {
  id: string;
  label: string;
  // Public buckets expose getPublicUrl; private buckets need a signed URL to
  // read bytes. Both are downloaded the same way via the authenticated client.
  isPublic: boolean;
}

export const BACKUP_BUCKETS: StorageBucket[] = [
  { id: 'book-covers', label: 'Book covers', isPublic: true },
  { id: 'bio-assets', label: 'Bio & link logos', isPublic: true },
  { id: 'media-outputs', label: 'Generated media', isPublic: true },
  { id: 'media-inputs', label: 'Media inputs', isPublic: false },
  { id: 'audiobook-audio', label: 'Audiobook audio', isPublic: false },
];

export interface BackupFile {
  schema_version: number;
  exported_at: string;
  user_id: string;
  tables: Record<string, any[]>;
}
