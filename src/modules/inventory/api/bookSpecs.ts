import { supabase } from '../../../lib/supabase';
import type { BookSpec } from '../../../lib/types';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function getBookSpecForProduct(productId: string): Promise<BookSpec | null> {
  const { data, error } = await supabase
    .from('book_specs')
    .select('*')
    .eq('product_id', productId)
    .maybeSingle();
  if (error) throw error;
  return data as BookSpec | null;
}

export async function getAllBookSpecs(): Promise<BookSpec[]> {
  const { data, error } = await supabase
    .from('book_specs')
    .select('*');
  if (error) throw error;
  return (data || []) as BookSpec[];
}

export type BookSpecPatch = Partial<Pick<BookSpec,
  'format' | 'trim_size' | 'lamination' | 'paper_gsm' | 'special_addons' |
  'bw_pages' | 'color_pages' | 'isbn' | 'notes'
>>;

export async function upsertBookSpec(productId: string, patch: BookSpecPatch): Promise<void> {
  const existing = await getBookSpecForProduct(productId);
  if (existing) {
    const { error } = await supabase
      .from('book_specs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }
  const user_id = await getUserId();
  const { error } = await supabase
    .from('book_specs')
    .insert({ user_id, product_id: productId, ...patch });
  if (error) throw error;
}
