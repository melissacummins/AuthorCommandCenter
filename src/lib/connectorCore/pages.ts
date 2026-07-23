// Landing Pages + Series Pages data-core for the MCP connector.
//
// Both are branded, public book/collection pages that live under the same
// per-user slug namespace as short_links. The public renderer at
// api/l/[slug].ts walks short_links → landing_pages → series_pages in
// order — first hit wins — so any tool that creates or renames a slug
// MUST verify uniqueness across all three tables (the DB only enforces
// per-table uniqueness).
//
// Client-injected per-request Supabase client; identity always comes from
// the JWT upstream. No service role, no user_id argument.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LandingPage, LandingPageInsert, LandingPageUpdate,
  SeriesPage, SeriesPageInsert, SeriesPageUpdate,
} from '../../modules/link-shortener/types';

// ============ Shared: cross-table slug uniqueness ============

// True if `slug` already exists for this user in short_links, landing_pages,
// or series_pages — optionally excluding a specific row (used when renaming
// an existing row so it doesn't conflict with itself).
async function isSlugTakenExcluding(
  client: SupabaseClient,
  userId: string,
  slug: string,
  exclude: { table: 'short_links' | 'landing_pages' | 'series_pages'; id: string } | null = null,
): Promise<boolean> {
  const check = (table: string) => {
    let query = client
      .from(table)
      .select('id')
      .eq('slug', slug)
      .eq('user_id', userId);
    if (exclude && exclude.table === table) query = query.neq('id', exclude.id);
    return query
      .maybeSingle()
      .then((r) => Boolean(r.data), () => false);
  };
  const [inLinks, inLanding, inSeries] = await Promise.all([
    check('short_links'),
    check('landing_pages'),
    check('series_pages'),
  ]);
  return inLinks || inLanding || inSeries;
}

// ============ Landing pages ============

export interface ListLandingPagesFilter {
  search?: string;
  limit?: number;
}

export async function listLandingPages(
  client: SupabaseClient,
  userId: string,
  filter: ListLandingPagesFilter = {},
): Promise<LandingPage[]> {
  let query = client
    .from('landing_pages')
    .select('*')
    .eq('user_id', userId);
  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim().replace(/[%_,]/g, '\\$&');
    query = query.or(
      `slug.ilike.%${q}%,title.ilike.%${q}%,headline.ilike.%${q}%,description.ilike.%${q}%`,
    );
  }
  query = query.order('created_at', { ascending: false });
  query = query.limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as LandingPage[];
}

export async function getLandingPage(
  client: SupabaseClient,
  userId: string,
  args: { id?: string; slug?: string },
): Promise<LandingPage | null> {
  if (!args.id && !args.slug) throw new Error('Must provide either id or slug.');
  let query = client.from('landing_pages').select('*').eq('user_id', userId);
  if (args.id) query = query.eq('id', args.id);
  else if (args.slug) query = query.eq('slug', args.slug);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data ?? null) as LandingPage | null;
}

async function assertSeriesPageOwnedByUser(
  client: SupabaseClient,
  userId: string,
  seriesPageId: string,
): Promise<void> {
  const { data, error } = await client
    .from('series_pages')
    .select('id')
    .eq('id', seriesPageId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`series_page_id "${seriesPageId}" doesn't exist for this account.`);
  }
}

export async function createLandingPage(
  client: SupabaseClient,
  userId: string,
  args: LandingPageInsert,
): Promise<LandingPage> {
  if (!args.slug || !args.slug.trim()) throw new Error('slug is required.');
  const slug = args.slug.trim();
  if (await isSlugTakenExcluding(client, userId, slug)) {
    throw new Error(`Slug "${slug}" is already in use for this account.`);
  }
  if (args.series_page_id) {
    await assertSeriesPageOwnedByUser(client, userId, args.series_page_id);
  }
  const payload = { ...args, slug, user_id: userId };
  const { data, error } = await client
    .from('landing_pages')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as LandingPage;
}

export interface UpdateLandingPageArgs extends LandingPageUpdate {
  id: string;
}

export async function updateLandingPage(
  client: SupabaseClient,
  userId: string,
  args: UpdateLandingPageArgs,
): Promise<LandingPage> {
  const { id, ...raw } = args;
  if (!id) throw new Error('id is required.');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one field must be provided to update.');
  }
  if (typeof patch.slug === 'string') {
    const newSlug = (patch.slug as string).trim();
    if (!newSlug) throw new Error('slug cannot be empty.');
    if (await isSlugTakenExcluding(client, userId, newSlug, { table: 'landing_pages', id })) {
      throw new Error(`Slug "${newSlug}" is already in use for this account.`);
    }
    patch.slug = newSlug;
  }
  if (typeof patch.series_page_id === 'string' && patch.series_page_id) {
    await assertSeriesPageOwnedByUser(client, userId, patch.series_page_id);
  }
  const { data, error } = await client
    .from('landing_pages')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as LandingPage;
}

// Hard delete matches the Command Center UI's Delete button. Landing pages
// have no click/conversion history attached (analytics aren't tracked at
// this layer). Cascade note: bio_blocks that referenced this landing page
// via landing_page_id are ALSO removed (ON DELETE CASCADE from migration
// 045). Series pages that included it in page_ids keep the id in the
// array but the resolved book card just disappears from the rendered page.
export async function deleteLandingPage(
  client: SupabaseClient,
  userId: string,
  args: { id: string },
): Promise<{ deleted: string }> {
  if (!args.id) throw new Error('id is required.');
  const { error } = await client
    .from('landing_pages')
    .delete()
    .eq('id', args.id)
    .eq('user_id', userId);
  if (error) throw error;
  return { deleted: args.id };
}

// ============ Series pages ============

async function assertLandingPageIdsOwnedByUser(
  client: SupabaseClient,
  userId: string,
  pageIds: string[],
): Promise<void> {
  if (!Array.isArray(pageIds) || pageIds.length === 0) return;
  const unique = Array.from(new Set(pageIds));
  const { data, error } = await client
    .from('landing_pages')
    .select('id')
    .eq('user_id', userId)
    .in('id', unique);
  if (error) throw error;
  const foundIds = new Set((data ?? []).map((r) => r.id as string));
  const missing = unique.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `These landing_page ids don't exist for this account: ${missing.join(', ')}`,
    );
  }
}

export interface ListSeriesPagesFilter {
  search?: string;
  limit?: number;
}

export async function listSeriesPages(
  client: SupabaseClient,
  userId: string,
  filter: ListSeriesPagesFilter = {},
): Promise<SeriesPage[]> {
  let query = client
    .from('series_pages')
    .select('*')
    .eq('user_id', userId);
  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim().replace(/[%_,]/g, '\\$&');
    query = query.or(`slug.ilike.%${q}%,title.ilike.%${q}%,description.ilike.%${q}%`);
  }
  query = query.order('created_at', { ascending: false });
  query = query.limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SeriesPage[];
}

export async function getSeriesPage(
  client: SupabaseClient,
  userId: string,
  args: { id?: string; slug?: string },
): Promise<SeriesPage | null> {
  if (!args.id && !args.slug) throw new Error('Must provide either id or slug.');
  let query = client.from('series_pages').select('*').eq('user_id', userId);
  if (args.id) query = query.eq('id', args.id);
  else if (args.slug) query = query.eq('slug', args.slug);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data ?? null) as SeriesPage | null;
}

export async function createSeriesPage(
  client: SupabaseClient,
  userId: string,
  args: SeriesPageInsert,
): Promise<SeriesPage> {
  if (!args.slug || !args.slug.trim()) throw new Error('slug is required.');
  const slug = args.slug.trim();
  if (await isSlugTakenExcluding(client, userId, slug)) {
    throw new Error(`Slug "${slug}" is already in use for this account.`);
  }
  if (args.page_ids) {
    await assertLandingPageIdsOwnedByUser(client, userId, args.page_ids);
  }
  const payload = { ...args, slug, user_id: userId };
  const { data, error } = await client
    .from('series_pages')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as SeriesPage;
}

export interface UpdateSeriesPageArgs extends SeriesPageUpdate {
  id: string;
}

export async function updateSeriesPage(
  client: SupabaseClient,
  userId: string,
  args: UpdateSeriesPageArgs,
): Promise<SeriesPage> {
  const { id, ...raw } = args;
  if (!id) throw new Error('id is required.');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error('At least one field must be provided to update.');
  }
  if (typeof patch.slug === 'string') {
    const newSlug = (patch.slug as string).trim();
    if (!newSlug) throw new Error('slug cannot be empty.');
    if (await isSlugTakenExcluding(client, userId, newSlug, { table: 'series_pages', id })) {
      throw new Error(`Slug "${newSlug}" is already in use for this account.`);
    }
    patch.slug = newSlug;
  }
  if (Array.isArray(patch.page_ids)) {
    await assertLandingPageIdsOwnedByUser(client, userId, patch.page_ids as string[]);
  }
  const { data, error } = await client
    .from('series_pages')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as SeriesPage;
}

// Hard delete matches the Command Center UI. Cascade note: landing_pages
// that referenced this series via series_page_id have that field cleared
// (ON DELETE SET NULL from migration 050) — their cross-sell row goes
// empty but the landing pages themselves are untouched.
export async function deleteSeriesPage(
  client: SupabaseClient,
  userId: string,
  args: { id: string },
): Promise<{ deleted: string }> {
  if (!args.id) throw new Error('id is required.');
  const { error } = await client
    .from('series_pages')
    .delete()
    .eq('id', args.id)
    .eq('user_id', userId);
  if (error) throw error;
  return { deleted: args.id };
}
