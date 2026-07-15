import { supabase } from '../../../lib/supabase';

// Pulls line items from the last N days of synced Shopify orders and
// aggregates quantity sold per SKU. Divide by `days` for avg daily.
//
// Returned map keys are trimmed uppercase SKUs so callers can match products
// case-insensitively, matching the SKU normalization used in
// buildInventoryUpdates over in the orders module.
export interface SalesRate {
  totalSold: number;
  avgDaily: number;
  windowDays: number;
}

export async function getSalesRates(windowDays = 180): Promise<Map<string, SalesRate>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabase
    .from('shopify_orders')
    .select('order_date, line_items')
    .gte('order_date', cutoffIso);
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const row of data || []) {
    const items = (row.line_items as { sku?: string | null; quantity?: number | null }[]) || [];
    for (const it of items) {
      const rawSku = (it?.sku || '').trim();
      if (!rawSku) continue;
      const key = rawSku.toUpperCase();
      const qty = Number(it?.quantity) || 0;
      totals.set(key, (totals.get(key) || 0) + qty);
    }
  }

  const map = new Map<string, SalesRate>();
  for (const [sku, total] of totals) {
    map.set(sku, { totalSold: total, avgDaily: total / windowDays, windowDays });
  }
  return map;
}
