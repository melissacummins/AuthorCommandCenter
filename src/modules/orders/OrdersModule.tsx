import { useState } from 'react';
import { Settings, ShoppingCart } from 'lucide-react';
import { useShopifySettings } from './hooks/useShopifyOrders';
import ShopifySetup from './components/ShopifySetup';
import OrdersDashboard from './components/OrdersDashboard';
import Modal from '../../components/Modal';

export default function OrdersModule() {
  const { settings, loading, refetch } = useShopifySettings();
  const [showSettings, setShowSettings] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not configured or not yet authorized — show setup
  if (!settings || !settings.access_token) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-800">Shopify Orders</h2>
          <p className="text-slate-500 mt-1">
            Connect your Shopify store to automatically pull orders and match them to your products by SKU.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-1">Connect Your Store</h3>
          <p className="text-sm text-slate-500 mb-6">
            Enter your Shopify store URL and Admin API access token to get started.
          </p>
          <ShopifySetup settings={null} onSaved={refetch} />
        </div>

        {/* Setup Instructions */}
        <div className="mt-6 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-6">
          <h3 className="font-semibold text-indigo-800 mb-3">How to get your API credentials</h3>
          <ol className="space-y-2 text-sm text-indigo-700">
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">1.</span>
              Go to your <strong>Shopify Partners Dashboard</strong> or <strong>Store Admin &gt; Settings &gt; Apps &gt; Develop apps</strong>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">2.</span>
              Create a new app (name it "Command Center" or anything you like)
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">3.</span>
              Under <strong>Configuration</strong>, enable these Admin API scopes: <code className="bg-indigo-100 px-1 rounded">read_orders</code>, <code className="bg-indigo-100 px-1 rounded">read_products</code>, <code className="bg-indigo-100 px-1 rounded">write_products</code>, <code className="bg-indigo-100 px-1 rounded">read_locations</code>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">4.</span>
              Install the app on your store, then copy the <strong>Admin API access token</strong>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  // Configured — show dashboard
  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Shopify Orders</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Pull orders by fulfillment location and match to products by SKU
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
        >
          <Settings className="w-4 h-4" /> Shopify Settings
        </button>
      </div>

      <OrdersDashboard settings={settings} onSettingsRefresh={refetch} />

      {/* Settings Modal */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Shopify Settings" maxWidth="max-w-lg">
        <ShopifySetup settings={settings} onSaved={() => { refetch(); setShowSettings(false); }} />
      </Modal>
    </div>
  );
}
