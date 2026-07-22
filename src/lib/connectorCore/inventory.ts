// Client-injected data core for the Inventory domain (products, purchase
// orders, and recent Shopify orders).
//
// Like dashboardCore.ts, these functions power the MCP connector (api/mcp.ts).
// They MUST NOT import the browser Supabase singleton (src/lib/supabase.ts uses
// import.meta.env, which doesn't exist server-side), must not import React, and
// must not use import.meta. The MCP server passes a per-request client built
// from the caller's OAuth token, so every query here runs under that user's
// RLS. Every query also filters by user_id explicitly to match the app.
//
// The alerts view (products at/below reorder point, sales-rate enriched) already
// lives in dashboardCore.ts as getInventoryAlertsCore — not duplicated here.
// These functions expose the flatter, browse-the-table data the Inventory
// module shows: the product catalog, the purchase-order log, and recent orders.
//
// Tables:
//   products        — src/lib/types.ts Product
//   purchase_orders — src/lib/types.ts PurchaseOrder
//   shopify_orders  — src/lib/types.ts ShopifyOrder (supabase/migrations/002_shopify_orders.sql)

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Result shapes (plain, JSON-serializable)

/** The key columns the Inventory table renders per product. */
export interface ProductSummary {
  id: string;
  name: string;
  sku: string;
  category: string;
  base_price: number;
  production_cost: number;
  shipping_cost: number;
  /** Directly-managed on-hand book count (Shopify sync + PO arrivals + manual). */
  book_inventory: number;
  bundles_inventory: number;
  six_month_book_sales: number;
  six_month_bundle_sales: number;
  lead_time: number;
  /** Manual average-daily override; 0 when unset. */
  csv_avg_daily: number;
  /** Manual reorder point; 0 when unset (the app also derives one live). */
  csv_reorder_threshold: number;
  do_not_reorder: boolean;
}

const PRODUCT_COLUMNS =
  'id, name, sku, category, base_price, production_cost, shipping_cost, ' +
  'book_inventory, bundles_inventory, six_month_book_sales, six_month_bundle_sales, ' +
  'lead_time, csv_avg_daily, csv_reorder_threshold, do_not_reorder';

/** Every product in the user's catalog, with the fields the Inventory table
    shows. Ordered by name. */
export async function listProducts(
  client: SupabaseClient,
  userId: string,
): Promise<ProductSummary[]> {
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProductSummary[];
}

// ---------------------------------------------------------------------------
// Purchase orders

export interface PurchaseOrderSummary {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  actual_quantity: number | null;
  status: 'pending' | 'arrived';
  vendor: string;
  po_number: string | null;
  order_date: string;
  expected_arrival: string;
  actual_arrival: string | null;
  created_at: string;
}

const PO_COLUMNS =
  'id, product_id, product_name, quantity, actual_quantity, status, vendor, ' +
  'po_number, order_date, expected_arrival, actual_arrival, created_at';

/** The user's purchase orders, newest first. Pass { status } to filter to
    'pending' (on order) or 'arrived' (received). */
export async function listPurchaseOrders(
  client: SupabaseClient,
  userId: string,
  opts: { status?: 'pending' | 'arrived' } = {},
): Promise<PurchaseOrderSummary[]> {
  let q = client
    .from('purchase_orders')
    .select(PO_COLUMNS)
    .eq('user_id', userId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PurchaseOrderSummary[];
}

// ---------------------------------------------------------------------------
// Recent Shopify orders

export interface OrderSummary {
  id: string;
  order_number: string;
  order_date: string;
  customer_name: string;
  financial_status: string;
  fulfillment_status: string;
  total_price: number;
  cancelled_at: string | null;
  /** Distinct line-item rows on the order. */
  lineItemCount: number;
  /** Total units across all line items (sum of quantities). */
  itemQuantity: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  order_date: string;
  customer_name: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: number | null;
  cancelled_at: string | null;
  line_items: unknown;
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Recent Shopify orders, newest first. Keeps the payload small: line items are
    summarized to a count + total quantity rather than dumped. Defaults to the
    last 30 days, up to 200 orders. Pass { fromDate: 'YYYY-MM-DD' } and/or
    { limit } to widen or narrow. */
export async function listOrders(
  client: SupabaseClient,
  userId: string,
  opts: { fromDate?: string; limit?: number } = {},
): Promise<OrderSummary[]> {
  const limit = opts.limit ?? 200;
  let fromDate = opts.fromDate;
  if (!fromDate) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    fromDate = isoDay(cutoff);
  }

  const { data, error } = await client
    .from('shopify_orders')
    .select(
      'id, order_number, order_date, customer_name, financial_status, ' +
      'fulfillment_status, total_price, cancelled_at, line_items',
    )
    .eq('user_id', userId)
    .gte('order_date', fromDate)
    .order('order_date', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as OrderRow[]).map((o) => {
    const items = (Array.isArray(o.line_items) ? o.line_items : []) as {
      quantity?: number | null;
    }[];
    const itemQuantity = items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0);
    return {
      id: o.id,
      order_number: o.order_number,
      order_date: o.order_date,
      customer_name: o.customer_name ?? '',
      financial_status: o.financial_status ?? '',
      fulfillment_status: o.fulfillment_status ?? '',
      total_price: Number(o.total_price) || 0,
      cancelled_at: o.cancelled_at,
      lineItemCount: items.length,
      itemQuantity,
    };
  });
}
