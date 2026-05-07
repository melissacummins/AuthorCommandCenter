import { supabase } from '../../lib/supabase';
import type { LinkClick, ShortLink, ShortLinkInsert, ShortLinkUpdate } from './types';
import { generateSlug, isValidSlug } from './utils';

export async function listLinks(userId: string): Promise<ShortLink[]> {
  const { data, error } = await supabase
    .from('short_links')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ShortLink[];
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  const { data, error } = await supabase
    .from('short_links')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return !data;
}

export async function generateUniqueSlug(maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const slug = generateSlug(7);
    if (await isSlugAvailable(slug)) return slug;
  }
  return generateSlug(9);
}

export async function createLink(
  userId: string,
  input: ShortLinkInsert,
): Promise<ShortLink> {
  const { data, error } = await supabase
    .from('short_links')
    .insert({ ...input, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as ShortLink;
}

export async function updateLink(id: string, patch: ShortLinkUpdate): Promise<ShortLink> {
  const { data, error } = await supabase
    .from('short_links')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ShortLink;
}

export async function deleteLink(id: string): Promise<void> {
  const { error } = await supabase.from('short_links').delete().eq('id', id);
  if (error) throw error;
}

export async function listClicks(
  userId: string,
  opts: { linkId?: string; sinceDays?: number; limit?: number } = {},
): Promise<LinkClick[]> {
  let query = supabase
    .from('link_clicks')
    .select('*')
    .eq('user_id', userId)
    .order('clicked_at', { ascending: false });
  if (opts.linkId) query = query.eq('link_id', opts.linkId);
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('clicked_at', since);
  }
  query = query.limit(opts.limit ?? 5000);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LinkClick[];
}
