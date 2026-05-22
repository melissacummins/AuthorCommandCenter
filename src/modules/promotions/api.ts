import { supabase } from '../../lib/supabase';
import type { Promotion, PromotionInsert, PromotionUpdate } from './types';

// Joined select that pulls the linked Catalog book's title and
// pen_name_id so the list view can attribute rows without a second
// lookup. Flattened on the way out.
const PROMO_SELECT = '*, book:books!book_id(id, title, pen_name_id)';

function flatten(raw: any): Promotion {
  const { book, ...rest } = raw;
  return {
    ...rest,
    book_title: book?.title ?? null,
    book_pen_name_id: book?.pen_name_id ?? null,
  } as Promotion;
}

export async function listPromotions(userId: string): Promise<Promotion[]> {
  const { data, error } = await supabase
    .from('promotions')
    .select(PROMO_SELECT)
    .eq('user_id', userId)
    .order('starts_on', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(flatten);
}

export async function createPromotion(userId: string, input: PromotionInsert): Promise<Promotion> {
  const { data, error } = await supabase
    .from('promotions')
    .insert({
      user_id: userId,
      book_id: input.book_id,
      kind: input.kind,
      name: input.name.trim(),
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      cost: input.cost ?? null,
      revenue: input.revenue ?? null,
      free_downloads: input.free_downloads ?? null,
      units_sold: input.units_sold ?? null,
      notes: input.notes ?? null,
    })
    .select(PROMO_SELECT)
    .single();
  if (error) throw error;
  return flatten(data);
}

export async function updatePromotion(id: string, patch: PromotionUpdate): Promise<Promotion> {
  const { data, error } = await supabase
    .from('promotions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(PROMO_SELECT)
    .single();
  if (error) throw error;
  return flatten(data);
}

export async function deletePromotion(id: string): Promise<void> {
  const { error } = await supabase.from('promotions').delete().eq('id', id);
  if (error) throw error;
}

// Promotion analytics. Returns ROI (revenue - cost) and a derived
// cost-per-unit / cost-per-download so the user can compare promos
// at a glance without doing arithmetic in their head.
export function promotionROI(p: Promotion): { net: number | null; costPerUnit: number | null } {
  const net = p.revenue !== null && p.cost !== null ? p.revenue - p.cost : null;
  const units = (p.units_sold ?? 0) + (p.free_downloads ?? 0);
  const costPerUnit = p.cost !== null && units > 0 ? p.cost / units : null;
  return { net, costPerUnit };
}
