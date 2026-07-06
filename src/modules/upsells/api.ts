import { supabase } from '../../lib/supabase';
import type { CatalogProduct, OfferStats, UpsellOffer, UpsellOfferDraft, WidgetSettings } from './types';
import { DEFAULT_WIDGET_SETTINGS } from './types';

// The metafield the storefront widget reads. Keep in sync with snippet.ts.
export const METAFIELD_NAMESPACE = 'author_cc';
export const METAFIELD_KEY = 'upsells';
// Hidden line-item property the widget stamps on add-ons it puts in the
// cart; order sync then attributes conversions to the trigger product.
export const ATTRIBUTION_PROPERTY = '_acc_upsell';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function callShopifyProxy(action: string, params?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('shopify_proxy', {
    action,
    params: params || {},
  });

  if (error) throw new Error(error.message || 'Shopify proxy call failed');
  if (data?.error) {
    const details = data.details ? ` — ${typeof data.details === 'string' ? data.details : JSON.stringify(data.details)}` : '';
    throw new Error(`${data.error}${details}`);
  }
  return data;
}

// GraphQL errors come back inside a 200 response; surface missing-scope
// failures with a hint about which permission to re-authorize for.
function throwGraphQLErrors(data: Record<string, unknown> | null | undefined, scopeHint: string) {
  const topErrors = (data as { errors?: { message: string }[] } | null)?.errors;
  if (topErrors?.length) {
    const msg = topErrors.map(e => e.message).join('; ');
    if (/access|scope|permission/i.test(msg)) {
      throw new Error(`Shopify rejected the write — the connection is missing the ${scopeHint} permission. Use "Re-authorize with Shopify" below, then save again.`);
    }
    throw new Error(msg);
  }
}

// ---- Product catalog (for the pickers) ----

export async function fetchProductCatalog(): Promise<CatalogProduct[]> {
  let all: CatalogProduct[] = [];
  let pageInfo: string | null = null;
  let page = 0;

  do {
    const params: Record<string, unknown> = {};
    if (pageInfo) params.page_info = pageInfo;
    const data = await callShopifyProxy('get_products_catalog', params);
    all = all.concat(data.products || []);
    pageInfo = data.nextPageInfo || null;
    page++;
  } while (pageInfo && page < 20);

  return all;
}

// ---- Offers (local table is the editable record; the metafield on the
// Shopify product is what the storefront widget actually reads) ----

export async function getOffers(): Promise<UpsellOffer[]> {
  const { data, error } = await supabase
    .from('upsell_offers')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

// The widget payload is keyed strictly by variant id + handle — never by
// image or price — so editing a product in Shopify can't break the offer.
export function buildMetafieldValue(
  offer: Pick<UpsellOfferDraft, 'heading' | 'enabled' | 'addons' | 'discount_enabled' | 'discount_type' | 'discount_value' | 'discount_text' | 'discount_includes_trigger'>,
  discountCode: string | null,
): string {
  const live = offer.enabled;
  const hasDiscount = live && offer.discount_enabled && !!discountCode;
  return JSON.stringify({
    version: 2,
    heading: offer.heading,
    discount: hasDiscount
      ? {
          code: discountCode,
          text: offer.discount_text,
          // pct drives the strikethrough price math in Liquid; fixed-value
          // discounts show the text only (the exact split is checkout's job)
          pct: offer.discount_type === 'percentage' ? offer.discount_value : null,
          // bundle-style: the trigger product is discounted too, so the
          // widget prices it (and pre-checks add-ons) accordingly
          trigger: offer.discount_includes_trigger,
        }
      : null,
    addons: live
      ? offer.addons.map(a => ({ variant_id: a.variant_id, handle: a.handle, label: a.label }))
      : [],
  });
}

async function pushMetafield(shopifyProductId: string, value: string): Promise<void> {
  const data = await callShopifyProxy('set_product_metafield', {
    product_id: shopifyProductId,
    namespace: METAFIELD_NAMESPACE,
    key: METAFIELD_KEY,
    value,
  });
  throwGraphQLErrors(data, 'write_products');
  const userErrors: { message: string }[] | undefined = data?.data?.metafieldsSet?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }
}

// ---- Discount code lifecycle ----

async function deleteDiscount(gid: string): Promise<void> {
  try {
    const data = await callShopifyProxy('delete_discount', { gid });
    throwGraphQLErrors(data, 'write_discounts');
  } catch {
    // The code may already be gone (deleted in Shopify admin) — that's the
    // state we wanted anyway.
  }
}

async function createDiscount(draft: UpsellOfferDraft, code: string): Promise<string> {
  const entitled = draft.addons.map(a => String(a.product_id));
  if (draft.discount_includes_trigger) {
    entitled.push(draft.shopify_product_id);
  }
  const data = await callShopifyProxy('create_discount', {
    code,
    title: `Add-on discount: ${draft.product_title}`,
    value_type: draft.discount_type,
    value: String(draft.discount_value),
    product_ids: entitled,
    combines_product: draft.discount_combines_product,
    combines_order: draft.discount_combines_order,
    combines_shipping: draft.discount_combines_shipping,
  });
  throwGraphQLErrors(data, 'write_discounts');
  const result = data?.data?.discountCodeBasicCreate;
  const userErrors: { message: string }[] | undefined = result?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }
  const gid: string | undefined = result?.codeDiscountNode?.id;
  if (!gid) throw new Error('Shopify did not return a discount id');
  return gid;
}

// Readable at checkout, unique per offer (product id suffix).
function discountCodeFor(draft: UpsellOfferDraft): string {
  const suffix = draft.shopify_product_id.slice(-6);
  return `ADDON-${suffix}`;
}

// Recreate-on-save keeps the Shopify code exactly in sync with the offer
// (value, add-on list, combines-with) without diffing entitlements.
async function reconcileDiscount(draft: UpsellOfferDraft): Promise<{ code: string | null; gid: string | null }> {
  if (draft.discount_gid) {
    await deleteDiscount(draft.discount_gid);
  }

  const wantsDiscount = draft.enabled && draft.discount_enabled && draft.discount_value > 0 && draft.addons.length > 0;
  if (!wantsDiscount) return { code: null, gid: null };

  let code = discountCodeFor(draft);
  try {
    const gid = await createDiscount(draft, code);
    return { code, gid };
  } catch (err: unknown) {
    // A foreign discount may already own this code — retry once with a
    // distinct suffix before giving up.
    if (err instanceof Error && /in use|already|taken/i.test(err.message)) {
      code = `${code}-${Date.now() % 1000}`;
      const gid = await createDiscount(draft, code);
      return { code, gid };
    }
    throw err;
  }
}

export async function pushOfferToShopify(offer: UpsellOfferDraft): Promise<void> {
  await pushMetafield(offer.shopify_product_id, buildMetafieldValue(offer, offer.discount_code ?? null));
}

export async function saveOffer(draft: UpsellOfferDraft): Promise<UpsellOffer> {
  // Order matters: discount first (so the metafield can carry the final
  // code), metafield second, local row last — if Shopify rejects a write
  // (e.g. missing scope), nothing half-saves locally.
  const { code, gid } = await reconcileDiscount(draft);
  await pushMetafield(draft.shopify_product_id, buildMetafieldValue(draft, code));

  const userId = await getUserId();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('upsell_offers')
    .upsert({
      user_id: userId,
      shopify_product_id: draft.shopify_product_id,
      product_title: draft.product_title,
      product_handle: draft.product_handle,
      product_image: draft.product_image,
      heading: draft.heading,
      enabled: draft.enabled,
      addons: draft.addons,
      discount_enabled: draft.discount_enabled,
      discount_type: draft.discount_type,
      discount_value: draft.discount_value,
      discount_text: draft.discount_text,
      discount_includes_trigger: draft.discount_includes_trigger,
      discount_combines_product: draft.discount_combines_product,
      discount_combines_order: draft.discount_combines_order,
      discount_combines_shipping: draft.discount_combines_shipping,
      discount_code: code,
      discount_gid: gid,
      synced_at: now,
      updated_at: now,
    }, { onConflict: 'user_id,shopify_product_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setOfferEnabled(offer: UpsellOffer, enabled: boolean): Promise<UpsellOffer> {
  return saveOffer({ ...offer, enabled });
}

export async function deleteOffer(offer: UpsellOffer): Promise<void> {
  if (offer.discount_gid) {
    await deleteDiscount(offer.discount_gid);
  }

  // Clear the metafield so the widget disappears from the product page,
  // then drop the local row.
  await pushMetafield(
    offer.shopify_product_id,
    buildMetafieldValue({ ...offer, enabled: false, addons: [] }, null),
  );

  const { error } = await supabase
    .from('upsell_offers')
    .delete()
    .eq('id', offer.id);
  if (error) throw error;
}

// ---- Theme snippet publish (one-click widget updates) ----

// The theme's Custom Liquid blocks contain only {% render 'acc-addons' %};
// the widget's actual code lives in snippets/acc-addons.liquid, which this
// pushes to the LIVE theme — so widget updates never need a manual re-paste.
export async function publishSnippetToTheme(snippet: string): Promise<string> {
  const themesData = await callShopifyProxy('get_themes');
  const themes: { id: number; name: string; role: string }[] = themesData.themes || [];
  const main = themes.find(t => t.role === 'main');
  if (!main) throw new Error('Could not find your live theme');

  const data = await callShopifyProxy('set_theme_asset', {
    theme_id: String(main.id),
    value: snippet,
  });
  if (!data?.asset?.key) throw new Error('Shopify did not confirm the snippet write');
  return main.name;
}

// ---- Widget design settings ----

export async function getWidgetSettings(): Promise<WidgetSettings> {
  const { data, error } = await supabase
    .from('upsell_widget_settings')
    .select('settings')
    .maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_WIDGET_SETTINGS, ...(data?.settings || {}) };
}

// Shop metafield first (that's what restyles the live store), local row
// second — a failed Shopify write leaves nothing half-saved.
export async function saveWidgetSettings(settings: WidgetSettings): Promise<void> {
  const data = await callShopifyProxy('set_shop_metafield', {
    namespace: METAFIELD_NAMESPACE,
    key: 'widget',
    value: JSON.stringify(settings),
  });
  throwGraphQLErrors(data, 'write_products');
  const userErrors: { message: string }[] | undefined = data?.data?.metafieldsSet?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }

  const userId = await getUserId();
  const { error } = await supabase
    .from('upsell_widget_settings')
    .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

// ---- Stats ----

interface RawLineItem {
  price?: string;
  quantity?: number;
  properties?: { name: string; value: string }[];
}

// Views/clicks from the widget's aggregate counters; conversions and value
// from synced Shopify orders (Inventory → Shopify Sync), attributed via the
// hidden line-item property the widget adds.
export async function getOfferStats(): Promise<Record<string, OfferStats>> {
  const stats: Record<string, OfferStats> = {};
  const ensure = (pid: string) => (stats[pid] ??= { views: 0, clicks: 0, conversions: 0, value: 0 });

  const [eventsRes, ordersRes] = await Promise.all([
    supabase.from('upsell_events').select('shopify_product_id, event_type, count'),
    supabase.from('shopify_orders').select('line_items'),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (ordersRes.error) throw ordersRes.error;

  for (const e of eventsRes.data || []) {
    const s = ensure(e.shopify_product_id);
    if (e.event_type === 'view') s.views += e.count;
    else if (e.event_type === 'click') s.clicks += e.count;
  }

  for (const order of ordersRes.data || []) {
    const lines: RawLineItem[] = Array.isArray(order.line_items)
      ? order.line_items
      : (typeof order.line_items === 'string' ? JSON.parse(order.line_items) : []);
    const triggersInOrder = new Set<string>();
    for (const line of lines) {
      const prop = line.properties?.find(p => p.name === ATTRIBUTION_PROPERTY);
      if (!prop?.value) continue;
      const s = ensure(prop.value);
      s.value += (parseFloat(line.price || '0') || 0) * (line.quantity || 1);
      triggersInOrder.add(prop.value);
    }
    for (const pid of triggersInOrder) ensure(pid).conversions += 1;
  }

  return stats;
}
