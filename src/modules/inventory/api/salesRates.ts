import { supabase } from '../../../lib/supabase';
import { aggregateSalesRates, type SalesRate } from '../utils';

export type { SalesRate };

// Pulls line items from the last N days of synced Shopify orders and
// aggregates quantity sold per SKU (see aggregateSalesRates in ../utils for
// the pure math). Returned map keys are trimmed uppercase SKUs so callers can
// match products case-insensitively, matching the SKU normalization used in
// buildInventoryUpdates over in the orders module.
export async function getSalesRates(windowDays = 180): Promise<Map<string, SalesRate>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const { data, error } = await supabase
    .from('shopify_orders')
    .select('order_date, line_items, refunds, cancelled_at')
    .gte('order_date', cutoff.toISOString());
  if (error) throw error;

  return aggregateSalesRates(data || [], windowDays);
}
