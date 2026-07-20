import { useEffect, useState } from 'react';
import { Store, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { getShopifySettings } from '../orders/api';
import ShopifySetup from '../orders/components/ShopifySetup';
import type { ShopifySettings } from '../../lib/types';

// The one home for the Shopify connection. Every Shopify-powered module
// (Inventory orders/sync, Upsells, and whatever comes next) shares this
// single connection; when a new module needs an extra permission, the
// scope list in orders/api.ts grows and one Re-authorize here picks it up.
export default function ShopifySection() {
  const [settings, setSettings] = useState<ShopifySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  async function load() {
    try {
      setSettings(await getShopifySettings());
    } catch { /* the setup card handles the unconfigured state */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <section className="bg-surface rounded-card border border-edge p-6 mb-6">
      <div className="flex items-center gap-3 mb-2">
        <Store className="w-5 h-5 text-emerald-600" />
        <h2 className="text-lg font-semibold text-content">Shopify Connection</h2>
      </div>
      <p className="text-sm text-content-secondary mb-6">
        One connection powers every Shopify feature — order sync and inventory in Inventory,
        offers in Upsells, and future modules. If a module ever reports a missing permission,
        come back here and click <strong>Re-authorize</strong> once.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        </div>
      ) : (
        <>
          <ShopifySetup settings={settings} onSaved={load} />

          <button
            onClick={() => setShowHelp(!showHelp)}
            className="mt-6 flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800"
          >
            {showHelp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            How to get your API credentials
          </button>

          {showHelp && (
            <div className="mt-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-card p-6">
              <ol className="space-y-2 text-sm text-indigo-700">
                <li className="flex gap-2">
                  <span className="font-bold text-indigo-500 shrink-0">1.</span>
                  Go to your <strong>Shopify Dev Dashboard</strong> and create or select an app
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-indigo-500 shrink-0">2.</span>
                  <span>
                    Under <strong>Versions</strong>, create a new version with these scopes:{' '}
                    <code className="bg-indigo-100 px-1 rounded">read_orders</code>,{' '}
                    <code className="bg-indigo-100 px-1 rounded">read_products</code>,{' '}
                    <code className="bg-indigo-100 px-1 rounded">write_products</code>,{' '}
                    <code className="bg-indigo-100 px-1 rounded">write_discounts</code>,{' '}
                    <code className="bg-indigo-100 px-1 rounded">read_locations</code>
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-indigo-500 shrink-0">3.</span>
                  <span>
                    Set the redirect URL to:{' '}
                    <code className="bg-indigo-100 px-1 rounded text-xs">{window.location.origin}/shopify/callback</code>
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-indigo-500 shrink-0">4.</span>
                  Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from Settings &rarr; Credentials
                </li>
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}
