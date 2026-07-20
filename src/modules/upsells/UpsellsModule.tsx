import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gift, Plus, Pencil, Trash2, Loader2, AlertCircle, ExternalLink, Code2, RefreshCw,
  Eye, MousePointerClick, ShoppingCart, BadgePercent, Store, Search, Paintbrush,
} from 'lucide-react';
import { getShopifySettings, getShopifyOAuthUrl } from '../orders/api';
import { fetchProductCatalog, getOffers, getOfferStats, setOfferEnabled, deleteOffer } from './api';
import OfferEditor from './components/OfferEditor';
import ThemeSetupTab from './components/ThemeSetupTab';
import WidgetDesignTab from './components/WidgetDesignTab';
import type { ShopifySettings } from '../../lib/types';
import type { CatalogProduct, OfferStats, UpsellOffer } from './types';

type Tab = 'offers' | 'design' | 'setup';
type SortBy = 'az' | 'za' | 'updated' | 'revenue';
type Filter = 'all' | 'live' | 'paused' | 'discount' | 'bundle';

export default function UpsellsModule() {
  const [settings, setSettings] = useState<ShopifySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [offers, setOffers] = useState<UpsellOffer[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('offers');
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<UpsellOffer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, OfferStats>>({});
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('az');
  const [filter, setFilter] = useState<Filter>('all');

  const loadAll = useCallback(async () => {
    try {
      const s = await getShopifySettings();
      setSettings(s);
      if (s?.access_token) {
        const [offerRows] = await Promise.all([getOffers()]);
        setOffers(offerRows);
        // Stats are non-critical decoration — never block the list on them.
        getOfferStats().then(setStats).catch(() => {});
        // Catalog loads in the background — the list renders without it.
        setCatalogLoading(true);
        fetchProductCatalog()
          .then(setCatalog)
          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load products from Shopify'))
          .finally(() => setCatalogLoading(false));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function refreshOffers() {
    try {
      setOffers(await getOffers());
      getOfferStats().then(setStats).catch(() => {});
    } catch { /* list refresh is best-effort; the save itself already succeeded */ }
  }

  function handleReauthorize() {
    if (!settings) return;
    const redirectUri = `${window.location.origin}/shopify/callback`;
    window.location.href = getShopifyOAuthUrl(settings.store_url, settings.client_id || '', redirectUri);
  }

  async function handleToggle(offer: UpsellOffer) {
    setBusyOffer(offer.id);
    setError('');
    try {
      await setOfferEnabled(offer, !offer.enabled);
      await refreshOffers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update offer');
    } finally {
      setBusyOffer(null);
    }
  }

  async function handleDelete(offer: UpsellOffer) {
    setBusyOffer(offer.id);
    setError('');
    try {
      await deleteOffer(offer);
      setConfirmDelete(null);
      await refreshOffers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete offer');
    } finally {
      setBusyOffer(null);
    }
  }

  // Hooks must run on every render, so this stays above the early returns
  // (loading / not-connected) — a conditional hook crashes React (#310).
  const q = query.trim().toLowerCase();
  const visibleOffers = useMemo(() => {
    const list = offers.filter(o => {
      if (filter === 'live' && !o.enabled) return false;
      if (filter === 'paused' && o.enabled) return false;
      if (filter === 'discount' && !o.discount_enabled) return false;
      if (filter === 'bundle' && !o.discount_includes_trigger) return false;
      if (!q) return true;
      return o.product_title.toLowerCase().includes(q)
        || o.addons.some(a => (a.label || a.title).toLowerCase().includes(q));
    });
    const revenue = (o: UpsellOffer) => stats[o.shopify_product_id]?.value ?? 0;
    return list.sort((a, b) => {
      if (sortBy === 'az') return a.product_title.localeCompare(b.product_title);
      if (sortBy === 'za') return b.product_title.localeCompare(a.product_title);
      if (sortBy === 'revenue') return revenue(b) - revenue(a);
      return +new Date(b.updated_at) - +new Date(a.updated_at);
    });
  }, [offers, q, filter, sortBy, stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  // Not connected yet — the connection lives in Settings, shared by all
  // Shopify-powered modules.
  if (!settings?.access_token) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
        <div className="bg-surface rounded-card border border-edge p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-brand-500 to-brand-600 rounded-card shadow-lg shadow-brand-500/25">
              <Gift className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-content">Upsells & Add-Ons</h2>
              <p className="text-sm text-content-secondary">Connect Shopify to manage add-on offers on your product pages.</p>
            </div>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700"
          >
            <Store className="w-4 h-4" /> Connect Shopify in Settings
          </Link>
        </div>
      </div>
    );
  }

  const takenProductIds = new Set(offers.filter(o => o.shopify_product_id !== editing?.shopify_product_id).map(o => o.shopify_product_id));
  const needsReauth = /write_products|write_discounts/i.test(error);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-content">Upsells & Add-Ons</h2>
          <p className="text-sm text-content-secondary mt-0.5">
            Your own SellEasy — add-on offers stored on your products, immune to image changes.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setEditorOpen(true); }}
          disabled={catalogLoading}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
        >
          {catalogLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {catalogLoading ? 'Loading products…' : 'New offer'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-edge/70 rounded-card p-1 w-fit">
        {([['offers', 'Offers', Gift], ['design', 'Design', Paintbrush], ['setup', 'Theme Setup', Code2]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === key ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-card mb-6">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-700">{error}</p>
            {needsReauth && (
              <button
                onClick={handleReauthorize}
                className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-control hover:bg-red-700"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Re-authorize with Shopify
              </button>
            )}
          </div>
          <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-red-600">Dismiss</button>
        </div>
      )}

      {tab === 'setup' && <ThemeSetupTab />}

      {tab === 'design' && <WidgetDesignTab offers={offers} />}

      {tab === 'offers' && (
        <>
          {offers.length === 0 ? (
            <div className="bg-surface rounded-card border border-edge p-10 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-brand-500 to-brand-600 rounded-card shadow-lg shadow-brand-500/25 mb-5">
                <Gift className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-content mb-1">No offers yet</h3>
              <p className="text-sm text-content-secondary max-w-md mx-auto mb-5">
                Create your first offer: pick a product, choose the add-ons that show under it,
                and save. Then do the one-time theme setup so the widget appears on your store.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => { setEditing(null); setEditorOpen(true); }}
                  disabled={catalogLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-brand-fg text-sm font-medium rounded-control hover:bg-brand-700 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Create an offer
                </button>
                <button
                  onClick={() => setTab('setup')}
                  className="flex items-center gap-2 px-4 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover"
                >
                  <Code2 className="w-4 h-4" /> Theme setup
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search / sort / filter toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search offers by product or add-on…"
                    className="w-full pl-9 pr-3 py-2 bg-surface border border-edge rounded-card text-sm text-content placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
                  />
                </div>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortBy)}
                  className="px-3 py-2 bg-surface border border-edge rounded-card text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  title="Sort offers"
                >
                  <option value="az">Title A–Z</option>
                  <option value="za">Title Z–A</option>
                  <option value="updated">Recently updated</option>
                  <option value="revenue">Top revenue</option>
                </select>
                <select
                  value={filter}
                  onChange={e => setFilter(e.target.value as Filter)}
                  className="px-3 py-2 bg-surface border border-edge rounded-card text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  title="Filter offers"
                >
                  <option value="all">All offers</option>
                  <option value="live">Live</option>
                  <option value="paused">Paused</option>
                  <option value="discount">With discount</option>
                  <option value="bundle">Bundle-style</option>
                </select>
              </div>
              {(q || filter !== 'all') && (
                <p className="text-xs text-content-muted px-1">
                  Showing {visibleOffers.length} of {offers.length} offers
                </p>
              )}
              {visibleOffers.length === 0 && (
                <div className="bg-surface rounded-card border border-edge p-8 text-center text-sm text-content-secondary">
                  No offers match{q ? <> &ldquo;{query.trim()}&rdquo;</> : ' this filter'}.
                </div>
              )}
              {visibleOffers.map(offer => {
                const busy = busyOffer === offer.id;
                const s = stats[offer.shopify_product_id];
                return (
                  <div key={offer.id} className={`bg-surface rounded-card border border-edge p-4 ${offer.enabled ? '' : 'opacity-60'}`}>
                    <div className="flex items-center gap-4">
                      {offer.product_image
                        ? <img src={offer.product_image} alt="" className="w-14 h-14 rounded-card object-cover shrink-0" />
                        : <div className="w-14 h-14 rounded-card bg-edge shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-content truncate">{offer.product_title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {offer.addons.map(a => (
                            <span key={a.variant_id} className="px-2 py-0.5 bg-brand-50 border border-brand-200 text-brand-700 rounded-full text-xs">
                              {a.label || a.title}
                            </span>
                          ))}
                          {offer.discount_enabled && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs">
                              <BadgePercent className="w-3 h-3" />
                              {offer.discount_type === 'percentage' ? `${offer.discount_value}% off` : `$${offer.discount_value} off`}
                              {offer.discount_includes_trigger && ' · bundle'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs text-content-secondary">
                        <span className="flex items-center gap-1" title="Widget views"><Eye className="w-3.5 h-3.5 text-content-muted" /> {s?.views ?? 0}</span>
                        <span className="flex items-center gap-1" title="Add-on clicks"><MousePointerClick className="w-3.5 h-3.5 text-content-muted" /> {s?.clicks ?? 0}</span>
                        <span className="flex items-center gap-1" title="Orders with an add-on"><ShoppingCart className="w-3.5 h-3.5 text-content-muted" /> {s?.conversions ?? 0}</span>
                        <span className="font-semibold text-emerald-600" title="Add-on revenue">${(s?.value ?? 0).toFixed(2)}</span>
                      </div>

                      {/* Enabled toggle */}
                      <button
                        onClick={() => handleToggle(offer)}
                        disabled={busy}
                        title={offer.enabled ? 'Live on your store — click to pause' : 'Paused — click to go live'}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${offer.enabled ? 'bg-emerald-500' : 'bg-edge-strong'} disabled:opacity-50`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-surface rounded-full shadow transition-all ${offer.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {busy ? (
                          <Loader2 className="w-4 h-4 text-content-muted animate-spin mx-2" />
                        ) : confirmDelete === offer.id ? (
                          <>
                            <button onClick={() => handleDelete(offer)} className="px-2.5 py-1.5 bg-red-600 text-white text-xs font-medium rounded-control hover:bg-red-700">
                              Delete
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1.5 text-xs text-content-secondary hover:text-content">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditing(offer); setEditorOpen(true); }}
                              disabled={catalogLoading}
                              className="p-2 text-content-muted hover:text-brand-600 rounded-control hover:bg-brand-50 disabled:opacity-40"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(offer.id)}
                              className="p-2 text-content-muted hover:text-red-600 rounded-control hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {offer.synced_at && (
                      <p className="flex items-center gap-1.5 text-xs text-content-muted mt-3">
                        <RefreshCw className="w-3 h-3" />
                        Synced to Shopify {new Date(offer.synced_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-content-muted px-1">
                Views and clicks are reported by the widget on your store. Conversions and revenue
                are counted from your synced Shopify orders (Inventory &rarr; Shopify sync), so run
                a sync to see the latest.
              </p>
            </div>
          )}
        </>
      )}

      {editorOpen && (
        <OfferEditor
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          catalog={catalog}
          existing={editing}
          takenProductIds={takenProductIds}
          onSaved={refreshOffers}
        />
      )}
    </div>
  );
}
