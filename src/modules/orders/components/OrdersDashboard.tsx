import { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, MapPin, Calendar, Package, ShoppingCart,
  ChevronDown, ChevronUp, AlertCircle, Loader2, Search, ArrowUpDown, CheckCircle2,
  Upload, Link2
} from 'lucide-react';
import {
  fetchShopifyLocations, fetchShopifyOrders, upsertOrders,
  logSync, updateLastSync, updateDefaultLocation,
  applyOrdersToInventory, syncShopifyProductMapping, pushInventoryToShopify,
  getSyncedOrders
} from '../api';
import type { InventoryUpdate } from '../api';
import { useShopifyOrders } from '../hooks/useShopifyOrders';
import type { ShopifySettings, ShopifyLocation, ShopifyLineItem, SkuMatch, Product } from '../../../lib/types';
import { calculateProductMetrics } from '../../inventory/utils';
import { supabase } from '../../../lib/supabase';

interface Props {
  settings: ShopifySettings;
  onSettingsRefresh: () => void;
}

type SortField = 'sku' | 'productName' | 'totalQuantity' | 'orderCount';
type SortDir = 'asc' | 'desc';

export default function OrdersDashboard({ settings, onSettingsRefresh }: Props) {
  // Locations
  const [locations, setLocations] = useState<ShopifyLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(settings.default_location_id || '');
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [syncSuccess, setSyncSuccess] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  // Orders — fetch ALL orders (not filtered by location in DB query)
  const { orders, loading: loadingOrders, refetch: refetchOrders } = useShopifyOrders();

  // Products for SKU matching
  const [products, setProducts] = useState<Product[]>([]);

  // Push to Shopify state
  const [mappingSyncing, setMappingSyncing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushError, setPushError] = useState('');

  // UI state
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('totalQuantity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [inventoryApplied, setInventoryApplied] = useState(false);

  // Load locations on mount
  useEffect(() => {
    loadLocations();
    loadProducts();
  }, []);

  async function loadLocations() {
    setLoadingLocations(true);
    try {
      const locs = await fetchShopifyLocations();
      setLocations(locs);
      if (!selectedLocationId && locs.length > 0) {
        setSelectedLocationId(String(locs[0].id));
      }
    } catch (err) {
      console.error('Failed to load locations:', err);
    } finally {
      setLoadingLocations(false);
    }
  }

  async function loadProducts() {
    const { data } = await supabase.from('products').select('*').order('name');
    if (data) setProducts(data);
  }

  async function handleLocationChange(locId: string) {
    setSelectedLocationId(locId);
    const loc = locations.find(l => String(l.id) === locId);
    if (loc) {
      await updateDefaultLocation(locId, loc.name);
      onSettingsRefresh();
    }
  }

  // SKU matching
  const skuMatches = useMemo((): SkuMatch[] => {
    const skuMap = new Map<string, { qty: number; orderIds: Set<string>; title: string }>();

    for (const order of orders) {
      const lineItems: ShopifyLineItem[] = typeof order.line_items === 'string'
        ? JSON.parse(order.line_items)
        : order.line_items;

      for (const item of lineItems) {
        if (!item.sku) continue;
        const key = item.sku.trim().toUpperCase();
        const existing = skuMap.get(key);
        if (existing) {
          existing.qty += item.quantity;
          existing.orderIds.add(order.shopify_order_id);
        } else {
          skuMap.set(key, {
            qty: item.quantity,
            orderIds: new Set([order.shopify_order_id]),
            title: item.title,
          });
        }
      }
    }

    return Array.from(skuMap.entries()).map(([sku, data]) => {
      const matchedProduct = products.find(p => p.sku.trim().toUpperCase() === sku);
      return {
        sku,
        productName: matchedProduct?.name || data.title,
        productId: matchedProduct?.id || '',
        category: matchedProduct?.category || '',
        totalQuantity: data.qty,
        orderCount: data.orderIds.size,
        isBundle: matchedProduct?.category === 'Bundle' || matchedProduct?.category === 'Book Box',
      };
    });
  }, [orders, products]);

  const filteredMatches = useMemo(() => {
    let result = skuMatches;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(m =>
        m.sku.toLowerCase().includes(s) ||
        m.productName.toLowerCase().includes(s)
      );
    }
    result.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return result;
  }, [skuMatches, search, sortField, sortDir]);

  const totalOrders = orders.length;
  const totalItems = skuMatches.reduce((sum, m) => sum + m.totalQuantity, 0);
  const matchedProducts = skuMatches.filter(m => m.productId).length;
  const unmatchedProducts = skuMatches.filter(m => !m.productId).length;

  // Sync orders from Shopify AND auto-apply to inventory
  async function handleSync() {
    setSyncing(true);
    setSyncError('');
    setSyncSuccess('');
    setInventoryApplied(false);

    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('Not authenticated');

      let allOrders: Record<string, unknown>[] = [];
      let pageInfo: string | null = null;
      let page = 0;

      // Paginate through all orders
      do {
        const params: Record<string, unknown> = {
          created_at_min: new Date(dateFrom).toISOString(),
          created_at_max: new Date(dateTo + 'T23:59:59').toISOString(),
          limit: 250,
        };
        if (pageInfo) params.page_info = pageInfo;

        const result = await fetchShopifyOrders(params);
        allOrders = allOrders.concat(result.orders);
        pageInfo = result.nextPageInfo;
        page++;
      } while (pageInfo && page < 20);

      const selectedLoc = locations.find(l => String(l.id) === selectedLocationId);
      const locationName = selectedLoc?.name || '';

      // Filter by location — include unfulfilled orders (they haven't been
      // assigned a fulfillment location yet but still represent pending sales)
      const filteredOrders = allOrders
        .filter((o: Record<string, unknown>) => {
          if (!selectedLocationId) return true;
          // Match if order's location_id matches
          if (String(o.location_id) === selectedLocationId) return true;
          // Match if any fulfillment is from this location
          const fulfillments = (o.fulfillments as Record<string, unknown>[]) || [];
          if (fulfillments.some((f: Record<string, unknown>) => String(f.location_id) === selectedLocationId)) return true;
          // Include unfulfilled orders (no fulfillments yet = hasn't shipped)
          const fulfillmentStatus = o.fulfillment_status as string | null;
          if (!fulfillmentStatus || fulfillmentStatus === 'null') return true;
          return false;
        })
        .map((o: Record<string, unknown>) => ({
          user_id: userId,
          shopify_order_id: String(o.id),
          order_number: String(o.name || o.order_number || ''),
          order_date: o.created_at as string,
          customer_name: o.customer
            ? `${(o.customer as Record<string, unknown>).first_name || ''} ${(o.customer as Record<string, unknown>).last_name || ''}`.trim()
            : '',
          fulfillment_status: (o.fulfillment_status as string) || 'unfulfilled',
          financial_status: (o.financial_status as string) || '',
          location_id: selectedLocationId,
          location_name: locationName,
          total_price: Number(o.total_price) || 0,
          line_items: o.line_items || [],
        }));

      const count = await upsertOrders(filteredOrders as Parameters<typeof upsertOrders>[0]);
      await updateLastSync();
      await logSync({
        sync_type: 'orders',
        status: 'success',
        orders_synced: count,
        date_range_start: dateFrom,
        date_range_end: dateTo,
        location_name: locationName,
        error_message: null,
      });

      onSettingsRefresh();
      await refetchOrders();
      await loadProducts();

      // Auto-apply to inventory.
      // applyOrdersToInventory uses cumulative delta tracking — it compares
      // `books_purchased` (lifetime total) against `quantitySold`. So we
      // have to feed it the lifetime total from local DB, not just this
      // sync window's batch, or syncs that follow earlier ones get skipped
      // when (window_qty - books_purchased) goes negative.
      const allLocalOrders = await getSyncedOrders();
      const inventoryUpdates = buildInventoryUpdates(allLocalOrders as unknown as Record<string, unknown>[], products);
      if (inventoryUpdates.length > 0) {
        const appliedCount = await applyOrdersToInventory(inventoryUpdates);
        await loadProducts(); // refresh products after update
        setInventoryApplied(true);
        setSyncSuccess(`Synced ${count} orders and updated inventory for ${appliedCount} products`);
      } else {
        setSyncSuccess(`Synced ${count} orders from "${locationName || 'all locations'}". No matching SKUs found to update inventory.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      setSyncError(message);
      await logSync({
        sync_type: 'orders',
        status: 'error',
        orders_synced: 0,
        date_range_start: dateFrom,
        date_range_end: dateTo,
        location_name: null,
        error_message: message,
      }).catch(() => {});
    } finally {
      setSyncing(false);
    }
  }

  // Sync SKU → inventory_item_id mapping from Shopify
  async function handleSyncMapping() {
    setMappingSyncing(true);
    setPushMessage('');
    setPushError('');
    try {
      const mapped = await syncShopifyProductMapping();
      await loadProducts();
      setPushMessage(`Linked ${mapped} product${mapped !== 1 ? 's' : ''} to Shopify inventory items by SKU`);
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Failed to sync product mapping');
    } finally {
      setMappingSyncing(false);
    }
  }

  // Push current inventory levels to Shopify
  async function handlePushToShopify() {
    if (!selectedLocationId) {
      setPushError('Please select a fulfillment location first.');
      return;
    }

    setPushing(true);
    setPushMessage('');
    setPushError('');
    try {
      const mappedProducts = products.filter(p => p.shopify_inventory_item_id);
      if (mappedProducts.length === 0) {
        setPushError('No products are linked to Shopify. Click "Link Products" first to map SKUs.');
        setPushing(false);
        return;
      }

      const updates = mappedProducts.map(p => {
        const metrics = calculateProductMetrics(p, products);
        const isBundle = p.category === 'Bundle' || p.category === 'Book Box';
        const qty = isBundle ? metrics.bundlesInventory : metrics.bookInventory;
        return {
          productId: p.id,
          productName: p.name,
          inventoryItemId: p.shopify_inventory_item_id!,
          available: Math.max(0, qty),
        };
      });

      const result = await pushInventoryToShopify(selectedLocationId, updates);
      if (result.failed > 0) {
        setPushError(`${result.failed} product${result.failed !== 1 ? 's' : ''} failed:\n${result.errors.map(e => `• ${e.productName}: ${e.error}`).join('\n')}`);
      }
      if (result.success > 0) {
        setPushMessage(`${result.success} product${result.success !== 1 ? 's' : ''} updated on Shopify`);
      }
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Failed to push inventory to Shopify');
    } finally {
      setPushing(false);
    }
  }

  const mappedCount = products.filter(p => p.shopify_inventory_item_id).length;

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-300" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  return (
    <div className="space-y-6">
      {/* Sync Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-4">Sync Orders from Shopify</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* Location Picker */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
              <MapPin className="w-3 h-3" /> Fulfillment Location
            </label>
            {loadingLocations ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading locations...
              </div>
            ) : (
              <select
                value={selectedLocationId}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All locations</option>
                {locations.map(loc => (
                  <option key={loc.id} value={String(loc.id)}>{loc.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Date From */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
              <Calendar className="w-3 h-3" /> From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
              <Calendar className="w-3 h-3" /> To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Sync Button */}
          <div className="flex items-end">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? 'Syncing...' : 'Sync & Update Inventory'}
            </button>
          </div>
        </div>

        {/* Last sync info */}
        {settings.last_sync_at && (
          <p className="text-xs text-slate-400">
            Last synced: {new Date(settings.last_sync_at).toLocaleString()}
            {settings.default_location_name && ` from "${settings.default_location_name}"`}
          </p>
        )}

        {/* Messages */}
        {syncError && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{syncError}</p>
          </div>
        )}
        {syncSuccess && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            {inventoryApplied && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
            <p className="text-sm text-emerald-700">{syncSuccess}</p>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShoppingCart} label="Total Orders" value={totalOrders} color="text-blue-600" bg="bg-blue-50" />
        <StatCard icon={Package} label="Total Items Sold" value={totalItems} color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard icon={Package} label="Matched SKUs" value={matchedProducts} color="text-emerald-600" bg="bg-emerald-50" />
        <StatCard icon={AlertCircle} label="Unmatched SKUs" value={unmatchedProducts} color="text-amber-600" bg="bg-amber-50" />
      </div>

      {/* Push to Shopify */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-800 mb-2">Push Inventory to Shopify</h3>
        <p className="text-sm text-slate-500 mb-4">
          Update your Shopify store's inventory levels to match what's in the app.
          Products are linked by SKU — click "Link Products" first if you haven't already.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-3">
          <button
            onClick={handleSyncMapping}
            disabled={mappingSyncing}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {mappingSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {mappingSyncing ? 'Linking...' : 'Link Products'}
          </button>
          <button
            onClick={handlePushToShopify}
            disabled={pushing || !selectedLocationId || mappedCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {pushing ? 'Pushing...' : 'Push to Shopify'}
          </button>
          <span className="text-xs text-slate-400">
            {mappedCount} of {products.length} products linked to Shopify
          </span>
        </div>

        {pushError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <pre className="text-sm text-red-700 whitespace-pre-wrap font-sans">{pushError}</pre>
          </div>
        )}
        {pushMessage && (
          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-700">{pushMessage}</p>
          </div>
        )}

        {/* Linked products detail */}
        {mappedCount > 0 && (
          <LinkedProductsTable products={products} />
        )}
      </div>

      {/* SKU Breakdown Table */}
      {!loadingOrders && orders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Sales by SKU</h3>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or product..."
                className="pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-4 py-3 font-medium text-slate-500">
                    <button onClick={() => toggleSort('sku')} className="flex items-center gap-1 hover:text-slate-700">
                      SKU <SortIcon field="sku" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-500">
                    <button onClick={() => toggleSort('productName')} className="flex items-center gap-1 hover:text-slate-700">
                      Product <SortIcon field="productName" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-500">Category</th>
                  <th className="px-4 py-3 font-medium text-slate-500 text-right">
                    <button onClick={() => toggleSort('totalQuantity')} className="flex items-center gap-1 ml-auto hover:text-slate-700">
                      Qty Sold <SortIcon field="totalQuantity" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-500 text-right">
                    <button onClick={() => toggleSort('orderCount')} className="flex items-center gap-1 ml-auto hover:text-slate-700">
                      Orders <SortIcon field="orderCount" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-500 text-center">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMatches.map(match => (
                  <tr key={match.sku} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{match.sku}</td>
                    <td className="px-4 py-3 text-slate-800">{match.productName}</td>
                    <td className="px-4 py-3">
                      {match.category ? (
                        <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                          match.isBundle
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {match.category}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{match.totalQuantity}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{match.orderCount}</td>
                    <td className="px-4 py-3 text-center">
                      {match.productId ? (
                        <span className="inline-flex w-5 h-5 items-center justify-center bg-emerald-100 text-emerald-600 rounded-full text-xs font-bold">&#10003;</span>
                      ) : (
                        <span className="inline-flex w-5 h-5 items-center justify-center bg-amber-100 text-amber-600 rounded-full text-xs font-bold">?</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredMatches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      {search ? 'No matching SKUs found.' : 'No order data yet. Sync orders to see results.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Orders List */}
      {!loadingOrders && orders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Recent Orders ({orders.length})</h3>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-slate-500">Order #</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Date</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Customer</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Items</th>
                  <th className="px-4 py-3 font-medium text-slate-500 text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.slice(0, 100).map(order => {
                  const lineItems: ShopifyLineItem[] = typeof order.line_items === 'string'
                    ? JSON.parse(order.line_items)
                    : order.line_items;
                  return (
                    <tr key={order.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{order.order_number}</td>
                      <td className="px-4 py-3 text-slate-600">{new Date(order.order_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-slate-600">{order.customer_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{lineItems.length} item{lineItems.length !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">${Number(order.total_price).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                          order.fulfillment_status === 'fulfilled'
                            ? 'bg-emerald-100 text-emerald-700'
                            : order.fulfillment_status === 'partial'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {order.fulfillment_status || 'unfulfilled'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loadingOrders && orders.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No orders synced yet</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Select a fulfillment location, choose a date range, and click "Sync & Update Inventory" to pull your Shopify orders and automatically update your product inventory.
          </p>
        </div>
      )}

      {loadingOrders && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      )}
    </div>
  );
}

// Build inventory updates by matching order line items to products by SKU
function buildInventoryUpdates(
  orders: Record<string, unknown>[],
  products: Product[]
): InventoryUpdate[] {
  const skuTotals = new Map<string, number>();

  for (const order of orders) {
    const lineItems = (order.line_items as { sku?: string; quantity: number }[]) || [];
    for (const item of lineItems) {
      if (!item.sku) continue;
      const key = item.sku.trim().toUpperCase();
      skuTotals.set(key, (skuTotals.get(key) || 0) + item.quantity);
    }
  }

  const updates: InventoryUpdate[] = [];
  for (const [sku, qty] of skuTotals) {
    const product = products.find(p => p.sku.trim().toUpperCase() === sku);
    if (product) {
      updates.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        isBundle: product.category === 'Bundle' || product.category === 'Book Box',
        quantitySold: qty,
      });
    }
  }

  return updates;
}

function LinkedProductsTable({ products }: { products: Product[] }) {
  const [expanded, setExpanded] = useState(false);
  const linked = products.filter(p => p.shopify_inventory_item_id);

  if (linked.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Hide' : 'Show'} linked products ({linked.length})
      </button>
      {expanded && (
        <div className="mt-2 overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2 font-medium text-slate-500">Product</th>
                <th className="px-3 py-2 font-medium text-slate-500">SKU</th>
                <th className="px-3 py-2 font-medium text-slate-500">Category</th>
                <th className="px-3 py-2 font-medium text-slate-500 text-right">Will Push</th>
                <th className="px-3 py-2 font-medium text-slate-500 text-right">Displayed Inventory</th>
                <th className="px-3 py-2 font-medium text-slate-500">Shopify Item ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linked.map(p => {
                const metrics = calculateProductMetrics(p, products);
                const isBundle = p.category === 'Bundle' || p.category === 'Book Box';
                const willPush = Math.max(0, isBundle ? metrics.bundlesInventory : metrics.bookInventory);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-800">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-slate-500">{p.sku}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isBundle ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                      }`}>{p.category}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-800">{willPush}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{isBundle ? metrics.bundlesInventory : metrics.bookInventory}</td>
                    <td className="px-3 py-2 font-mono text-slate-400 text-[10px]">{p.shopify_inventory_item_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, bg }: {
  icon: typeof ShoppingCart;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
