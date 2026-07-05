import { supabase } from '../../lib/supabase';
import type { CatalogProduct, UpsellOffer, UpsellOfferDraft } from './types';

// The metafield the storefront widget reads. Keep in sync with snippet.ts.
export const METAFIELD_NAMESPACE = 'author_cc';
export const METAFIELD_KEY = 'upsells';

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
export function buildMetafieldValue(offer: Pick<UpsellOfferDraft, 'heading' | 'enabled' | 'addons'>): string {
  return JSON.stringify({
    version: 1,
    heading: offer.heading,
    addons: offer.enabled
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

  // GraphQL errors come back inside a 200 response
  const topErrors: { message: string }[] | undefined = data?.errors;
  if (topErrors?.length) {
    const msg = topErrors.map(e => e.message).join('; ');
    if (/access|scope|permission/i.test(msg)) {
      throw new Error('Shopify rejected the write — the connection is missing the write_products permission. Use "Re-authorize with Shopify" below, then save again.');
    }
    throw new Error(msg);
  }
  const userErrors: { message: string }[] | undefined = data?.data?.metafieldsSet?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map(e => e.message).join('; '));
  }
}

export async function pushOfferToShopify(offer: UpsellOfferDraft): Promise<void> {
  await pushMetafield(offer.shopify_product_id, buildMetafieldValue(offer));
}

export async function saveOffer(draft: UpsellOfferDraft): Promise<UpsellOffer> {
  // Push to Shopify first: if the store rejects the write (e.g. missing
  // scope), nothing is saved locally and the error surfaces in the editor.
  await pushOfferToShopify(draft);

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
  // Clear the metafield so the widget disappears from the product page,
  // then drop the local row.
  await pushMetafield(offer.shopify_product_id, buildMetafieldValue({ heading: offer.heading, enabled: false, addons: [] }));

  const { error } = await supabase
    .from('upsell_offers')
    .delete()
    .eq('id', offer.id);
  if (error) throw error;
}
