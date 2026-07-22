// Link Shortener + Bio Page data-core for the MCP connector.
//
// Wraps the same tables the in-app link shortener uses (short_links,
// bio_blocks, link_folders, bio_settings) so Cowork / any MCP client
// reaches parity with the Command Center UI for the link and bio-page
// surfaces. Every function is client-injected (per-request Supabase
// client under the caller's RLS) — never the browser singleton, never
// service role — exactly like the other connectorCore modules.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BioBlock, BioBlockInsert, BioBlockUpdate, BioSettings,
  LinkFolder, ShortLink, ShortLinkUpdate,
} from '../../modules/link-shortener/types';

// ============ Short links ============

export interface ListShortLinksFilter {
  parentId?: string | null;
  folderId?: string | null;
  isActive?: boolean;
  includeArchived?: boolean;
  showOnBioOnly?: boolean;
  search?: string;
  limit?: number;
}

export async function listShortLinks(
  client: SupabaseClient,
  userId: string,
  filter: ListShortLinksFilter = {},
): Promise<ShortLink[]> {
  let query = client
    .from('short_links')
    .select('*')
    .eq('user_id', userId);
  if (filter.parentId === null) query = query.is('parent_id', null);
  else if (filter.parentId !== undefined) query = query.eq('parent_id', filter.parentId);
  if (filter.folderId === null) query = query.is('folder_id', null);
  else if (filter.folderId !== undefined) query = query.eq('folder_id', filter.folderId);
  if (typeof filter.isActive === 'boolean') query = query.eq('is_active', filter.isActive);
  if (!filter.includeArchived) query = query.is('archived_at', null);
  if (filter.showOnBioOnly) query = query.eq('show_on_bio', true);
  if (filter.search && filter.search.trim()) {
    // ILIKE OR-search across the fields a user would typically remember a
    // link by. Escape the % / _ / , wildcards so a literal search term isn't
    // reinterpreted (and , would otherwise split the OR expression).
    const q = filter.search.trim().replace(/[%_,]/g, '\\$&');
    query = query.or(
      `slug.ilike.%${q}%,label.ilike.%${q}%,destination_url.ilike.%${q}%,channel.ilike.%${q}%,bio_title.ilike.%${q}%`,
    );
  }
  query = query.order('created_at', { ascending: false });
  query = query.limit(Math.min(Math.max(filter.limit ?? 200, 1), 500));
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ShortLink[];
}

export async function getShortLink(
  client: SupabaseClient,
  userId: string,
  args: { id?: string; slug?: string },
): Promise<ShortLink | null> {
  if (!args.id && !args.slug) {
    throw new Error('Must provide either id or slug.');
  }
  let query = client.from('short_links').select('*').eq('user_id', userId);
  if (args.id) query = query.eq('id', args.id);
  else if (args.slug) query = query.eq('slug', args.slug);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data ?? null) as ShortLink | null;
}

// Cross-namespace slug uniqueness check. short_links share a per-user slug
// namespace with landing_pages and series_pages; landing/series tables may
// not exist on older schemas so failures on those checks silently pass.
async function isSlugTaken(
  client: SupabaseClient,
  userId: string,
  slug: string,
): Promise<boolean> {
  const check = (table: string) =>
    client
      .from(table)
      .select('id')
      .eq('slug', slug)
      .eq('user_id', userId)
      .maybeSingle()
      .then((r) => Boolean(r.data), () => false);
  const [inLinks, inLanding, inSeries] = await Promise.all([
    check('short_links'),
    check('landing_pages'),
    check('series_pages'),
  ]);
  return inLinks || inLanding || inSeries;
}

// Highest bio_sort_order across short_links AND bio_blocks, plus one. Used
// so new bio-enabled items land at the bottom of a user's carefully
// arranged order instead of stacking at sort_order = 0.
async function nextBioSortOrder(
  client: SupabaseClient,
  userId: string,
): Promise<number> {
  const linkRes = await client
    .from('short_links')
    .select('bio_sort_order')
    .eq('user_id', userId)
    .order('bio_sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const blockRes = await client
    .from('bio_blocks')
    .select('bio_sort_order')
    .eq('user_id', userId)
    .order('bio_sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));
  const maxLink = linkRes.data?.bio_sort_order ?? -1;
  const maxBlock = (blockRes as { data: { bio_sort_order?: number } | null }).data?.bio_sort_order ?? -1;
  return Math.max(maxLink, maxBlock) + 1;
}

export interface CreateShortLinkArgs {
  slug: string;
  destination_url: string;
  label?: string;
  channel?: string;
  notes?: string;
  tags?: string[];
  is_active?: boolean;
  parent_id?: string | null;
  folder_id?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  expired_redirect_url?: string | null;
  show_on_bio?: boolean;
  bio_title?: string;
  bio_style?: 'card' | 'icon';
  thumbnail_url?: string | null;
}

export async function createShortLink(
  client: SupabaseClient,
  userId: string,
  args: CreateShortLinkArgs,
): Promise<ShortLink> {
  if (!args.slug || !args.slug.trim()) throw new Error('slug is required.');
  if (!args.destination_url || !args.destination_url.trim()) {
    throw new Error('destination_url is required.');
  }
  if (await isSlugTaken(client, userId, args.slug.trim())) {
    throw new Error(`Slug "${args.slug.trim()}" is already in use for this account.`);
  }
  const showOnBio = args.show_on_bio !== false;
  const isVariant = Boolean(args.parent_id);
  let bioSortOrder: number | undefined;
  if (showOnBio && !isVariant) {
    bioSortOrder = await nextBioSortOrder(client, userId);
  }
  const payload: Record<string, unknown> = {
    user_id: userId,
    slug: args.slug.trim(),
    destination_url: args.destination_url.trim(),
    label: args.label ?? '',
    channel: args.channel ?? '',
    notes: args.notes ?? '',
    tags: args.tags ?? [],
    is_active: args.is_active ?? true,
    parent_id: args.parent_id ?? null,
    folder_id: args.folder_id ?? null,
    starts_at: args.starts_at ?? null,
    expires_at: args.expires_at ?? null,
    expired_redirect_url: args.expired_redirect_url ?? null,
    show_on_bio: showOnBio,
    bio_title: args.bio_title ?? '',
    bio_style: args.bio_style ?? 'card',
    thumbnail_url: args.thumbnail_url ?? null,
  };
  if (bioSortOrder !== undefined) payload.bio_sort_order = bioSortOrder;
  const { data, error } = await client
    .from('short_links')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as ShortLink;
}

export interface UpdateShortLinkArgs {
  id: string;
  label?: string;
  destination_url?: string;
  channel?: string;
  notes?: string;
  tags?: string[];
  is_active?: boolean;
  folder_id?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  expired_redirect_url?: string | null;
  show_on_bio?: boolean;
  bio_title?: string;
  bio_style?: 'card' | 'icon';
  thumbnail_url?: string | null;
  bio_sort_order?: number;
}

export async function updateShortLink(
  client: SupabaseClient,
  userId: string,
  args: UpdateShortLinkArgs,
): Promise<ShortLink> {
  const { id, ...raw } = args;
  if (!id) throw new Error('id is required.');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one field must be provided to update.');
  }
  const { data, error } = await client
    .from('short_links')
    .update(patch as ShortLinkUpdate)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as ShortLink;
}

// Soft-delete: sets archived_at + deactivates the link (readers get the
// branded "unavailable" page). Pass unarchive: true to restore. Preferred
// over any hard-delete tool per the MCP connector directive — preserves
// click and conversion history attached to this link.
export async function archiveShortLink(
  client: SupabaseClient,
  userId: string,
  args: { id: string; unarchive?: boolean },
): Promise<ShortLink> {
  if (!args.id) throw new Error('id is required.');
  const patch = args.unarchive
    ? { archived_at: null, is_active: true }
    : { archived_at: new Date().toISOString(), is_active: false };
  const { data, error } = await client
    .from('short_links')
    .update(patch)
    .eq('id', args.id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as ShortLink;
}

// ============ Link folders ============

export async function listLinkFolders(
  client: SupabaseClient,
  userId: string,
): Promise<LinkFolder[]> {
  const { data, error } = await client
    .from('link_folders')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as LinkFolder[]).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

export async function createLinkFolder(
  client: SupabaseClient,
  userId: string,
  args: { name: string; color?: string },
): Promise<LinkFolder> {
  if (!args.name || !args.name.trim()) throw new Error('name is required.');
  const { data, error } = await client
    .from('link_folders')
    .insert({
      user_id: userId,
      name: args.name.trim(),
      color: args.color ?? '#6366f1',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LinkFolder;
}

export async function updateLinkFolder(
  client: SupabaseClient,
  userId: string,
  args: { id: string; name?: string; color?: string; sort_order?: number },
): Promise<LinkFolder> {
  const { id, ...raw } = args;
  if (!id) throw new Error('id is required.');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one field must be provided to update.');
  }
  const { data, error } = await client
    .from('link_folders')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as LinkFolder;
}

// Folders are purely organizational — dropping a folder leaves its links
// intact (folder_id becomes null via ON DELETE SET NULL). Analogous to
// delete_cash_flow_line, hard delete is safe here.
export async function deleteLinkFolder(
  client: SupabaseClient,
  userId: string,
  args: { id: string },
): Promise<{ deleted: string }> {
  if (!args.id) throw new Error('id is required.');
  const { error } = await client
    .from('link_folders')
    .delete()
    .eq('id', args.id)
    .eq('user_id', userId);
  if (error) throw error;
  return { deleted: args.id };
}

// ============ Bio blocks (sections + image cards) ============

export async function listBioBlocks(
  client: SupabaseClient,
  userId: string,
): Promise<BioBlock[]> {
  const { data, error } = await client
    .from('bio_blocks')
    .select('*')
    .eq('user_id', userId)
    .order('bio_sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BioBlock[];
}

export async function createBioBlock(
  client: SupabaseClient,
  userId: string,
  args: BioBlockInsert,
): Promise<BioBlock> {
  if (args.type !== 'section' && args.type !== 'image') {
    throw new Error("type must be either 'section' or 'image'.");
  }
  const sortOrder = args.bio_sort_order ?? (await nextBioSortOrder(client, userId));
  const { data, error } = await client
    .from('bio_blocks')
    .insert({
      user_id: userId,
      type: args.type,
      title: args.title ?? null,
      body: args.body ?? null,
      image_url: args.image_url ?? null,
      link_url: args.link_url ?? null,
      bio_sort_order: sortOrder,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BioBlock;
}

export async function updateBioBlock(
  client: SupabaseClient,
  userId: string,
  args: { id: string } & BioBlockUpdate,
): Promise<BioBlock> {
  const { id, ...raw } = args;
  if (!id) throw new Error('id is required.');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one field must be provided to update.');
  }
  patch.updated_at = new Date().toISOString();
  const { data, error } = await client
    .from('bio_blocks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as BioBlock;
}

// Bio blocks are lightweight display config (like cash-flow lines), not
// user-authored content — a section header or image card row doesn't have
// click / conversion history attached. Hard delete is safe.
export async function deleteBioBlock(
  client: SupabaseClient,
  userId: string,
  args: { id: string },
): Promise<{ deleted: string }> {
  if (!args.id) throw new Error('id is required.');
  const { error } = await client
    .from('bio_blocks')
    .delete()
    .eq('id', args.id)
    .eq('user_id', userId);
  if (error) throw error;
  return { deleted: args.id };
}

// ============ Bio page settings ============

export async function getBioSettings(
  client: SupabaseClient,
  userId: string,
): Promise<BioSettings | null> {
  const { data, error } = await client
    .from('bio_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as BioSettings | null;
}

// Only writable field today is logo_url. The actual image upload has to
// happen in-app (it needs authed access to Supabase Storage under the
// caller's per-user folder); this tool just points bio_settings at a
// public URL — either one already in the bio-assets bucket, or an
// external CDN URL.
export async function upsertBioSettings(
  client: SupabaseClient,
  userId: string,
  args: { logo_url?: string | null },
): Promise<BioSettings> {
  const patch: Record<string, unknown> = { user_id: userId };
  if (args.logo_url !== undefined) patch.logo_url = args.logo_url;
  if (Object.keys(patch).length === 1) {
    // Only user_id in patch means no updatable fields were provided.
    throw new Error('At least one settings field must be provided.');
  }
  const { data, error } = await client
    .from('bio_settings')
    .upsert(patch, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as BioSettings;
}
