import { supabase } from '../../lib/supabase';
import type {
  AttributionSettings, BioSettings, ConversionInsert, LinkClick, LinkConversion, LinkFolder,
  ShortLink, ShortLinkInsert, ShortLinkUpdate,
} from './types';
import { generateSlug, isValidSlug } from './utils';

// ============ Links ============

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

export async function createLink(userId: string, input: ShortLinkInsert): Promise<ShortLink> {
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

// Reorders bio links by writing fresh bio_sort_order indices in parallel.
// Pass an array of link IDs in the desired order; each gets index 0..n-1.
export async function reorderBioLinks(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('short_links').update({ bio_sort_order: idx }).eq('id', id),
    ),
  );
}

// ============ Folders ============

export async function listFolders(userId: string): Promise<LinkFolder[]> {
  const { data, error } = await supabase
    .from('link_folders')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  // Alphabetical, case-insensitive, locale-aware.
  return ((data ?? []) as LinkFolder[]).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export async function createFolder(userId: string, name: string, color = '#6366f1'): Promise<LinkFolder> {
  const { data, error } = await supabase
    .from('link_folders')
    .insert({ user_id: userId, name, color })
    .select('*')
    .single();
  if (error) throw error;
  return data as LinkFolder;
}

export async function updateFolder(id: string, patch: Partial<Pick<LinkFolder, 'name' | 'color' | 'sort_order'>>): Promise<LinkFolder> {
  const { data, error } = await supabase
    .from('link_folders')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as LinkFolder;
}

export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('link_folders').delete().eq('id', id);
  if (error) throw error;
}

// ============ Clicks ============

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

// ============ Conversions ============

export async function listConversions(userId: string, opts: { linkId?: string; limit?: number } = {}): Promise<LinkConversion[]> {
  let query = supabase
    .from('link_conversions')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });
  if (opts.linkId) query = query.eq('link_id', opts.linkId);
  query = query.limit(opts.limit ?? 500);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LinkConversion[];
}

export async function createConversion(userId: string, input: ConversionInsert): Promise<LinkConversion> {
  const { data, error } = await supabase
    .from('link_conversions')
    .insert({
      user_id: userId,
      source: input.source ?? 'manual',
      currency: input.currency ?? 'USD',
      value: input.value ?? 0,
      notes: input.notes ?? '',
      external_ref: input.external_ref ?? null,
      click_id: input.click_id ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      link_id: input.link_id,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LinkConversion;
}

export async function deleteConversion(id: string): Promise<void> {
  const { error } = await supabase.from('link_conversions').delete().eq('id', id);
  if (error) throw error;
}

// ============ Attribution settings ============

export async function getAttributionSettings(userId: string): Promise<AttributionSettings | null> {
  const { data, error } = await supabase
    .from('link_attribution_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AttributionSettings | null;
}

export async function upsertAttributionSettings(
  userId: string,
  patch: Partial<Pick<AttributionSettings, 'shopify_webhook_secret' | 'click_id_param' | 'attribution_window_minutes'>>,
): Promise<AttributionSettings> {
  const { data, error } = await supabase
    .from('link_attribution_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as AttributionSettings;
}

// ============ Bio settings ============

export async function getBioSettings(userId: string): Promise<BioSettings | null> {
  const { data, error } = await supabase
    .from('bio_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BioSettings | null;
}

export async function upsertBioSettings(
  userId: string,
  patch: Partial<Pick<BioSettings, 'logo_url'>>,
): Promise<BioSettings> {
  const { data, error } = await supabase
    .from('bio_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as BioSettings;
}

// Uploads a logo image to the per-user folder in the bio-assets bucket
// and returns the public URL. Cleans up any previously-uploaded logo
// files in the same folder so we don't accumulate orphaned blobs.
export async function uploadBioLogo(userId: string, file: File): Promise<string> {
  const { data: existing } = await supabase.storage.from('bio-assets').list(userId);
  if (existing && existing.length > 0) {
    const oldPaths = existing
      .filter((f) => f.name.toLowerCase().startsWith('logo.'))
      .map((f) => `${userId}/${f.name}`);
    if (oldPaths.length > 0) {
      await supabase.storage.from('bio-assets').remove(oldPaths);
    }
  }

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
  const path = `${userId}/logo.${ext}`;
  const { error } = await supabase.storage
    .from('bio-assets')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;

  const { data } = supabase.storage.from('bio-assets').getPublicUrl(path);
  // Append a cache-buster so the bio page picks up the new logo immediately
  // without waiting for CDN/edge cache to invalidate.
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeBioLogo(userId: string): Promise<void> {
  const { data: existing } = await supabase.storage.from('bio-assets').list(userId);
  if (existing && existing.length > 0) {
    const paths = existing
      .filter((f) => f.name.toLowerCase().startsWith('logo.'))
      .map((f) => `${userId}/${f.name}`);
    if (paths.length > 0) {
      await supabase.storage.from('bio-assets').remove(paths);
    }
  }
  await supabase
    .from('bio_settings')
    .upsert({ user_id: userId, logo_url: null }, { onConflict: 'user_id' });
}
