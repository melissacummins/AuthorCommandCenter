import { supabase } from '../../../lib/supabase';
import type { PrinterQuote } from '../../../lib/types';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function getQuotesForProduct(productId: string): Promise<PrinterQuote[]> {
  const { data, error } = await supabase
    .from('printer_quotes')
    .select('*')
    .eq('product_id', productId)
    .order('unit_cost', { ascending: true });
  if (error) throw error;
  return (data || []) as PrinterQuote[];
}

export type QuotePatch = Partial<Pick<PrinterQuote,
  'printer' | 'unit_cost' | 'shipping_estimate' | 'past_order_count' | 'notes'
>>;

export async function createQuote(productId: string, patch: QuotePatch): Promise<PrinterQuote> {
  const user_id = await getUserId();
  const { data, error } = await supabase
    .from('printer_quotes')
    .insert({ user_id, product_id: productId, printer: '', unit_cost: 0, shipping_estimate: 0, past_order_count: 0, ...patch })
    .select('*')
    .single();
  if (error) throw error;
  return data as PrinterQuote;
}

export async function updateQuote(id: string, patch: QuotePatch): Promise<void> {
  const { error } = await supabase
    .from('printer_quotes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase
    .from('printer_quotes')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
