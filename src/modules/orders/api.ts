import { supabase } from '../../lib/supabase';
import type { ShopifySettings, ShopifyOrder, ShopifySyncLog } from '../../lib/types';

type ShopifySettingsInsert = {
  store_url: string;
  client_id: string;
  client_secret: string;
};

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ---- Shopify Settings ----

export async function getShopifySettings(): Promise<ShopifySettings | null> {
  const { data, error } = await supabase
    .from('shopify_settings')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveShopifySettings(settings: ShopifySettingsInsert): Promise<ShopifySettings> {
  const userId = await getUserId();
  const existing = await getShopifySettings();

  if (existing) {
    const { data, error } = await supabase
      .from('shopify_settings')
      .update({
        store_url: settings.store_url,
        client_id: settings.client_id,
        client_secret: settings.client_secret,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('shopify_settings')
    .insert({ ...settings, user_id: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- OAuth Token Exchange ----

export async function exchangeOAuthCode(code: string): Promise<{ success: boolean; scope?: string }> {
  const { data, error } = await supabase.rpc('shopify_exchange_token', {
    p_code: code,
  });

  if (error) throw new Error(error.message || 'Token exchange failed');
  if (data?.error) throw new Error(data.error);
  return data;
}

export function getShopifyOAuthUrl(storeUrl: string, clientId: string, redirectUri: string): string {
  // write_products covers the upsell metafields the storefront widget reads,
  // write_discounts covers the per-offer discount codes (Upsells module),
  // write_themes lets the app publish the widget as a theme snippet so
  // updates never need a manual re-paste; everything else is read-only.
  const scopes = 'read_orders,read_products,write_products,write_discounts,read_locations,read_themes,write_themes';
  return `https://${storeUrl}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export async function updateDefaultLocation(locationId: string, locationName: string): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('shopify_settings')
    .update({
      default_location_id: locationId,
      default_location_name: locationName,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function deleteShopifySettings(): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('shopify_settings')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- Shopify API Proxy (via Database Function) ----

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

export async function testShopifyConnection(): Promise<{ shop: { name: string; domain: string } }> {
  return callShopifyProxy('test_connection');
}

export async function fetchShopifyLocations() {
  const data = await callShopifyProxy('get_locations');
  return data.locations || [];
}

// ---- Shopify Products (for SKU → inventory_item_id mapping) ----

export async function fetchShopifyProducts(): Promise<{ id: number; title: string; variants: { id: number; sku: string; inventory_item_id: number }[] }[]> {
  let allProducts: { id: number; title: string; variants: { id: number; sku: string; inventory_item_id: number }[] }[] = [];
  let pageInfo: string | null = null;
  let page = 0;

  do {
    const params: Record<string, unknown> = {};
    if (pageInfo) params.page_info = pageInfo;
    const data = await callShopifyProxy('get_products', params);
    allProducts = allProducts.concat(data.products || []);
    pageInfo = data.nextPageInfo || null;
    page++;
  } while (pageInfo && page < 20);

  return allProducts;
}

export async function syncShopifyProductMapping(): Promise<number> {
  const shopifyProducts = await fetchShopifyProducts();
  const { data: localProducts } = await supabase.from('products').select('id, sku');
  if (!localProducts) return 0;

  let mapped = 0;
  for (const sp of shopifyProducts) {
    for (const variant of sp.variants || []) {
      if (!variant.sku) continue;
      const match = localProducts.find(lp => lp.sku.trim().toUpperCase() === variant.sku.trim().toUpperCase());
      if (match) {
        await supabase.from('products').update({
          shopify_inventory_item_id: String(variant.inventory_item_id),
          shopify_variant_id: String(variant.id),
          updated_at: new Date().toISOString(),
        }).eq('id', match.id);
        mapped++;
      }
    }
  }
  return mapped;
}

// ---- Shopify Inventory Read/Write ----

export async function getShopifyInventoryLevels(locationId: string, inventoryItemIds: string[]): Promise<{ inventory_item_id: number; available: number }[]> {
  const data = await callShopifyProxy('get_inventory_levels', {
    location_id: locationId,
    inventory_item_ids: inventoryItemIds.join(','),
  });
  return data.inventory_levels || [];
}

export async function setShopifyInventoryLevel(locationId: string, inventoryItemId: string, available: number): Promise<void> {
  await callShopifyProxy('set_inventory', {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available: String(available),
  });
}

export interface PushResult {
  success: number;
  failed: number;
  errors: { productName: string; error: string }[];
}

export async function pushInventoryToShopify(
  locationId: string,
  updates: { productId: string; productName: string; inventoryItemId: string; available: number }[]
): Promise<PushResult> {
  let success = 0;
  let failed = 0;
  const errors: { productName: string; error: string }[] = [];

  for (const u of updates) {
    try {
      await setShopifyInventoryLevel(locationId, u.inventoryItemId, u.available);
      success++;
    } catch (err: unknown) {
      failed++;
      errors.push({
        productName: u.productName,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { success, failed, errors };
}

export interface FetchOrdersParams {
  created_at_min?: string;
  created_at_max?: string;
  status?: string;
  limit?: number;
  page_info?: string;
}

export async function fetchShopifyOrders(params?: FetchOrdersParams) {
  const data = await callShopifyProxy('get_orders', params as Record<string, unknown> | undefined);
  return {
    orders: data.orders || [],
    nextPageInfo: data.nextPageInfo || null,
  };
}

// ---- Synced Orders (local DB) ----

export async function getSyncedOrders(locationId?: string): Promise<ShopifyOrder[]> {
  let query = supabase
    .from('shopify_orders')
    .select('*')
    .order('order_date', { ascending: false });

  if (locationId) {
    query = query.eq('location_id', locationId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function upsertOrders(orders: Omit<ShopifyOrder, 'id' | 'synced_at'>[]): Promise<number> {
  if (orders.length === 0) return 0;

  const { error } = await supabase
    .from('shopify_orders')
    .upsert(orders, { onConflict: 'user_id,shopify_order_id' });

  if (error) throw error;
  return orders.length;
}

export async function clearSyncedOrders(): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('shopify_orders')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- Sync Log ----

export async function getSyncLogs(limit = 10): Promise<ShopifySyncLog[]> {
  const { data, error } = await supabase
    .from('shopify_sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function logSync(entry: Omit<ShopifySyncLog, 'id' | 'user_id' | 'created_at'>): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('shopify_sync_log')
    .insert({ ...entry, user_id: userId });
  if (error) throw error;
}

// ---- Update last sync timestamp ----

export async function updateLastSync(): Promise<void> {
  const userId = await getUserId();
  const { error } = await supabase
    .from('shopify_settings')
    .update({
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- Update product inventory from order data ----

export interface InventoryUpdate {
  productId: string;
  productName: string;
  sku: string;
  isBundle: boolean;
  quantitySold: number;
}

export async function applyOrdersToInventory(updates: InventoryUpdate[]): Promise<number> {
  const userId = await getUserId();
  let updated = 0;

  for (const u of updates) {
    // Fetch current product values
    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('book_inventory, bundles_inventory, books_purchased, bundles_purchased')
      .eq('id', u.productId)
      .single();

    if (fetchErr || !product) continue;

    // Calculate the delta: how many MORE sold since last sync
    const prevSold = u.isBundle
      ? (product.bundles_purchased || 0)
      : (product.books_purchased || 0);
    const delta = u.quantitySold - prevSold;

    // Skip if nothing new sold
    if (delta <= 0) continue;

    const currentInventory = u.isBundle
      ? (product.bundles_inventory || 0)
      : (product.book_inventory || 0);
    const newInventory = currentInventory - delta;

    const updateFields: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (u.isBundle) {
      updateFields.bundles_purchased = u.quantitySold;
      updateFields.bundles_inventory = newInventory;
    } else {
      updateFields.books_purchased = u.quantitySold;
      updateFields.book_inventory = newInventory;
    }

    const { error: updateErr } = await supabase
      .from('products')
      .update(updateFields)
      .eq('id', u.productId);

    if (updateErr) continue;

    // Log the inventory adjustment
    await supabase.from('inventory_orders').insert({
      user_id: userId,
      product_id: u.productId,
      type: 'subtract',
      inventory_type: u.isBundle ? 'bundle' : 'book',
      quantity: delta,
      previous_value: currentInventory,
      new_value: newInventory,
      source: 'Shopify Sync',
      notes: `${delta} new sold (${u.quantitySold} total from Shopify)`,
    });

    // Cascade bundle sales to each component product so the live bundle
    // math (min component inventory) reflects what's actually consumable.
    // Without this, every bundle sale leaves the components untouched and
    // the bundle would still show as available even after all its parts
    // were given away in earlier sales.
    if (u.isBundle && delta > 0) {
      await cascadeBundleSaleToComponents(userId, u.productId, delta);
    }

    updated++;
  }

  return updated;
}

async function cascadeBundleSaleToComponents(userId: string, bundleProductId: string, delta: number): Promise<void> {
  const { data: bundle, error: bundleErr } = await supabase
    .from('products')
    .select('name, books_in_bundle')
    .eq('id', bundleProductId)
    .single();
  if (bundleErr || !bundle?.books_in_bundle) return;

  const componentNames = bundle.books_in_bundle
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  for (const name of componentNames) {
    // Prefer non-bundle products with an exact (case-insensitive) name match.
    // ilike with no wildcards = case-insensitive equality.
    const { data: comp, error: compErr } = await supabase
      .from('products')
      .select('id, name, purchased_via_bundles, book_inventory, category')
      .eq('user_id', userId)
      .ilike('name', name)
      .not('category', 'in', '("Bundle","Book Box")')
      .maybeSingle();
    if (compErr || !comp) continue;

    const prevPvb = comp.purchased_via_bundles || 0;
    const prevInv = comp.book_inventory || 0;
    const newPvb = prevPvb + delta;
    const newInv = prevInv - delta;

    const { error: updErr } = await supabase
      .from('products')
      .update({
        purchased_via_bundles: newPvb,
        book_inventory: newInv,
        updated_at: new Date().toISOString(),
      })
      .eq('id', comp.id);
    if (updErr) continue;

    await supabase.from('inventory_orders').insert({
      user_id: userId,
      product_id: comp.id,
      type: 'subtract',
      inventory_type: 'book',
      quantity: delta,
      previous_value: prevInv,
      new_value: newInv,
      source: 'Bundle Cascade',
      notes: `${delta} consumed via "${bundle.name}" sale`,
    });
  }
}
