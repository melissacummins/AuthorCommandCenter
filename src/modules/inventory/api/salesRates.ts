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
    .select('order_date, line_items, refunds, cancelled_at')
    .gte('order_date', cutoffIso);
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const row of data || []) {
    if (row.cancelled_at) continue; // cancelled order — nothing net-sold
    const items = (row.line_items as { id?: number; sku?: string | null; quantity?: number | null }[]) || [];
    const refunds = (row.refunds as { refund_line_items?: { line_item_id?: number; quantity?: number }[] }[]) || [];

    const refundedByLineItem = new Map<number, number>();
    for (const r of refunds) {
      for (const rli of r.refund_line_items || []) {
        if (rli.line_item_id == null) continue;
        refundedByLineItem.set(rli.line_item_id, (refundedByLineItem.get(rli.line_item_id) || 0) + (Number(rli.quantity) || 0));
      }
    }

    for (const it of items) {
      const rawSku = (it?.sku || '').trim();
      if (!rawSku) continue;
      const key = rawSku.toUpperCase();
      const refunded = it.id != null ? (refundedByLineItem.get(it.id) || 0) : 0;
      const netQty = (Number(it?.quantity) || 0) - refunded;
      if (netQty <= 0) continue;
      totals.set(key, (totals.get(key) || 0) + netQty);
    }
  }

  const map = new Map<string, SalesRate>();
  for (const [sku, total] of totals) {
    map.set(sku, { totalSold: total, avgDaily: total / windowDays, windowDays });
  }
  return map;
}
