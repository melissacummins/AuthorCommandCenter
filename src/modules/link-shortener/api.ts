import { supabase } from '../../lib/supabase';
import type {
  AttributionSettings, BioBlock, BioBlockInsert, BioBlockUpdate, BioSettings, BioView,
  ConversionInsert, CustomDomain, LinkClick, LinkConversion, LinkFolder,
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

// Looks across short_links AND bio_blocks for the highest bio_sort_order
// for this user, returning what should be the NEXT slot. Used to put new
// bio items at the bottom of the list rather than at the top.
async function nextBioSortOrder(userId: string): Promise<number> {
  const [linksRes, blocksRes] = await Promise.all([
    supabase
      .from('short_links')
      .select('bio_sort_order')
      .eq('user_id', userId)
      .order('bio_sort_order', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('bio_blocks')
      .select('bio_sort_order')
      .eq('user_id', userId)
      .order('bio_sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r, () => ({ data: null })),
  ]);
  const maxLink = linksRes.data?.bio_sort_order ?? -1;
  const maxBlock = (blocksRes as { data: { bio_sort_order?: number } | null }).data?.bio_sort_order ?? -1;
  return Math.max(maxLink, maxBlock) + 1;
}

export async function createLink(userId: string, input: ShortLinkInsert): Promise<ShortLink> {
  // New links stay OFF the bio page unless explicitly opted in, so the bio
  // page stays a curated set instead of collecting every ARC variant or
  // one-off campaign link. Toggle a link on from its detail drawer.
  const showOnBio = input.show_on_bio === true;
  const payload: ShortLinkInsert & { user_id: string } = { ...input, show_on_bio: showOnBio, user_id: userId };
  if (input.bio_sort_order === undefined && showOnBio && !input.parent_id) {
    payload.bio_sort_order = await nextBioSortOrder(userId);
  }
  const { data, error } = await supabase
    .from('short_links')
    .insert(payload)
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

// Reorders mixed bio items (links + blocks) by writing fresh sort indices
// across BOTH tables in parallel so the global order stays consistent.
export async function reorderBioItems(
  items: { kind: 'link' | 'block'; id: string }[],
): Promise<void> {
  await Promise.all(
    items.map((item, idx) => {
      if (item.kind === 'link') {
        return supabase.from('short_links').update({ bio_sort_order: idx }).eq('id', item.id);
      }
      return supabase.from('bio_blocks').update({ bio_sort_order: idx }).eq('id', item.id);
    }),
  );
}

// ============ Folders ============

export async function listFolders(userId: string): Promise<LinkFolder[]> {
  const { data, error } = await supabase
    .from('link_folders')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
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
  opts: { linkId?: string; sinceDays?: number; limit?: number; isBot?: boolean } = {},
): Promise<LinkClick[]> {
  let query = supabase
    .from('link_clicks')
    .select('*')
    .eq('user_id', userId)
    .order('clicked_at', { ascending: false });
  if (opts.linkId) query = query.eq('link_id', opts.linkId);
  if (typeof opts.isBot === 'boolean') query = query.eq('is_bot', opts.isBot);
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('clicked_at', since);
  }
  query = query.limit(opts.limit ?? 5000);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LinkClick[];
}

// ============ Bio page views ============

export async function listBioViews(userId: string, opts: { sinceDays?: number; limit?: number } = {}): Promise<BioView[]> {
  let query = supabase
    .from('bio_views')
    .select('*')
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false });
  if (opts.sinceDays) {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('viewed_at', since);
  }
  query = query.limit(opts.limit ?? 10000);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as BioView[];
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

// ============ Bio settings + blocks + assets ============

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
  patch: Partial<Pick<BioSettings, 'logo_url' | 'bio_title' | 'bio_subtitle' | 'theme' | 'accent_color'>>,
): Promise<BioSettings> {
  const { data, error } = await supabase
    .from('bio_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as BioSettings;
}

export async function listBioBlocks(userId: string): Promise<BioBlock[]> {
  const { data, error } = await supabase
    .from('bio_blocks')
    .select('*')
    .eq('user_id', userId)
    .order('bio_sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BioBlock[];
}

export async function createBioBlock(userId: string, input: BioBlockInsert): Promise<BioBlock> {
  const sortOrder = input.bio_sort_order ?? (await nextBioSortOrder(userId));
  const { data, error } = await supabase
    .from('bio_blocks')
    .insert({ ...input, user_id: userId, bio_sort_order: sortOrder })
    .select('*')
    .single();
  if (error) throw error;
  return data as BioBlock;
}

export async function updateBioBlock(id: string, patch: BioBlockUpdate): Promise<BioBlock> {
  const { data, error } = await supabase
    .from('bio_blocks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as BioBlock;
}

export async function deleteBioBlock(id: string): Promise<void> {
  const { error } = await supabase.from('bio_blocks').delete().eq('id', id);
  if (error) throw error;
}

// ============ Custom domains ============

export async function listCustomDomains(userId: string): Promise<CustomDomain[]> {
  const { data, error } = await supabase
    .from('custom_domains')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CustomDomain[];
}

export async function addCustomDomain(userId: string, domain: string): Promise<CustomDomain> {
  // Normalize: strip protocol, path, whitespace, and a leading "www.".
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  const { data, error } = await supabase
    .from('custom_domains')
    .insert({ user_id: userId, domain: clean })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomDomain;
}

export async function deleteCustomDomain(id: string): Promise<void> {
  const { error } = await supabase.from('custom_domains').delete().eq('id', id);
  if (error) throw error;
}

// The verified domain to use when building short URLs for this user, or null
// if they have not connected one yet. Prefers a domain flagged primary.
export async function getPrimaryDomain(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('custom_domains')
    .select('domain, is_primary, created_at')
    .eq('user_id', userId)
    .eq('verified', true)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.domain ?? null;
}

function safeExt(file: File): string {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5);
  return ext.replace(/[^a-z0-9]/g, '') || 'png';
}

// Logo upload — single file under <user>/logo.<ext>, replaces previous.
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
  const path = `${userId}/logo.${safeExt(file)}`;
  const { error } = await supabase.storage
    .from('bio-assets')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('bio-assets').getPublicUrl(path);
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

// General-purpose bio image upload (image cards, future thumbnails). Each
// upload gets a unique filename so multiple images can coexist for the
// same user without overwriting each other.
export async function uploadBioImage(userId: string, file: File): Promise<string> {
  const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/blocks/${id}.${safeExt(file)}`;
  const { error } = await supabase.storage
    .from('bio-assets')
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('bio-assets').getPublicUrl(path);
  return data.publicUrl;
}
