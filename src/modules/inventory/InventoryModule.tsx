import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, List, Plus, ShoppingCart, Settings, Truck, BookOpen, FileSpreadsheet } from 'lucide-react';
import { useProducts } from './hooks/useProducts';
import { useShopifySettings } from '../orders/hooks/useShopifyOrders';
import Dashboard from './components/Dashboard';
import ProductTable from './components/ProductTable';
import AddProductForm from './components/AddProductForm';
import StockModal from './components/StockModal';
import PurchaseOrders from './components/PurchaseOrders';
import BookSpecsTab from './components/BookSpecsTab';
import PrinterQuotesTab from './components/PrinterQuotesTab';
import OrdersDashboard from '../orders/components/OrdersDashboard';
import ShopifySetup from '../orders/components/ShopifySetup';
import Modal from '../../components/Modal';
import { getPendingByProduct } from './api/purchaseOrders';
import type { Product } from '../../lib/types';

type Tab = 'dashboard' | 'products' | 'book-specs' | 'printer-quotes' | 'purchase-orders' | 'orders';

export default function InventoryModule() {
  const { products, loading, refetch } = useProducts();
  const { settings: shopifySettings, loading: shopifyLoading, refetch: refetchShopify } = useShopifySettings();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [duplicateFrom, setDuplicateFrom] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);

  function startDuplicate(p: Product) {
    setDuplicateFrom(p);
    setShowAddProduct(true);
  }

  function closeAddProduct() {
    setShowAddProduct(false);
    setDuplicateFrom(null);
  }
  const [showShopifySettings, setShowShopifySettings] = useState(false);
  const [pendingStock, setPendingStock] = useState<Map<string, number>>(new Map());

  const fetchPending = useCallback(async () => {
    const pending = await getPendingByProduct();
    setPendingStock(pending);
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'dashboard' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </button>
          <button
            onClick={() => setTab('products')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'products' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <List className="w-4 h-4" /> Products
          </button>
          <button
            onClick={() => setTab('book-specs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'book-specs' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <BookOpen className="w-4 h-4" /> Book Specs
          </button>
          <button
            onClick={() => setTab('printer-quotes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'printer-quotes' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" /> Printer Quotes
          </button>
          <button
            onClick={() => setTab('purchase-orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'purchase-orders' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Truck className="w-4 h-4" /> Purchase Orders
          </button>
          <button
            onClick={() => setTab('orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'orders' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <ShoppingCart className="w-4 h-4" /> Shopify
          </button>
        </div>

        <div className="flex gap-2">
          {tab === 'orders' && shopifySettings?.access_token && (
            <button
              onClick={() => setShowShopifySettings(true)}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              <Settings className="w-4 h-4" /> Shopify Settings
            </button>
          )}
          {(tab === 'dashboard' || tab === 'products') && (
            <button
              onClick={() => setShowAddProduct(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Product
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {tab === 'dashboard' && (
        <Dashboard
          products={products}
          onAddProduct={() => setShowAddProduct(true)}
          onAdjustStock={() => setTab('products')}
        />
      )}
      {tab === 'products' && (
        <ProductTable
          products={products}
          onRefetch={refetch}
          onAdjustStock={setStockProduct}
          onDuplicate={startDuplicate}
          pendingStock={pendingStock}
        />
      )}
      {tab === 'book-specs' && <BookSpecsTab />}
      {tab === 'printer-quotes' && <PrinterQuotesTab />}
      {tab === 'purchase-orders' && (
        <PurchaseOrders
          products={products}
          onInventoryChanged={() => { refetch(); fetchPending(); }}
        />
      )}
      {tab === 'orders' && (
        <OrdersTab
          shopifySettings={shopifySettings}
          shopifyLoading={shopifyLoading}
          refetchShopify={refetchShopify}
          refetchProducts={refetch}
        />
      )}

      {/* Add Product Modal */}
      <Modal open={showAddProduct} onClose={closeAddProduct} title={duplicateFrom ? `Duplicate "${duplicateFrom.name}"` : 'Add New Product'} maxWidth="max-w-2xl">
        <AddProductForm onClose={closeAddProduct} onRefetch={refetch} duplicateFrom={duplicateFrom} />
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal open={!!stockProduct} onClose={() => setStockProduct(null)} title="Adjust Stock">
        {stockProduct && (
          <StockModal product={stockProduct} onClose={() => setStockProduct(null)} onRefetch={refetch} />
        )}
      </Modal>

      {/* Shopify Settings Modal */}
      <Modal open={showShopifySettings} onClose={() => setShowShopifySettings(false)} title="Shopify Settings" maxWidth="max-w-lg">
        <ShopifySetup settings={shopifySettings} onSaved={() => { refetchShopify(); setShowShopifySettings(false); }} />
      </Modal>
    </div>
  );
}

function OrdersTab({ shopifySettings, shopifyLoading, refetchShopify, refetchProducts }: {
  shopifySettings: ReturnType<typeof useShopifySettings>['settings'];
  shopifyLoading: boolean;
  refetchShopify: () => void;
  refetchProducts: () => void;
}) {
  if (shopifyLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not connected — show setup
  if (!shopifySettings || !shopifySettings.access_token) {
    return (
      <div className="max-w-3xl">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <h3 className="font-semibold text-slate-800 mb-1">Connect Your Shopify Store</h3>
          <p className="text-sm text-slate-500 mb-6">
            Pull orders directly from Shopify by fulfillment location and automatically update your inventory.
          </p>
          <ShopifySetup settings={shopifySettings} onSaved={refetchShopify} />
        </div>

        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-6">
          <h3 className="font-semibold text-indigo-800 mb-3">How to get your API credentials</h3>
          <ol className="space-y-2 text-sm text-indigo-700">
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">1.</span>
              Go to your <strong>Shopify Dev Dashboard</strong> and create or select an app
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">2.</span>
              Under <strong>Versions</strong>, create a new version with these scopes: <code className="bg-indigo-100 px-1 rounded">read_orders</code>, <code className="bg-indigo-100 px-1 rounded">read_products</code>, <code className="bg-indigo-100 px-1 rounded">write_products</code>, <code className="bg-indigo-100 px-1 rounded">read_locations</code>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">3.</span>
              Set the redirect URL to: <code className="bg-indigo-100 px-1 rounded text-xs">{window.location.origin}/shopify/callback</code>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-indigo-500 shrink-0">4.</span>
              Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from Settings &rarr; Credentials
            </li>
          </ol>
        </div>
      </div>
    );
  }

  // Connected — show orders dashboard
  return (
    <OrdersDashboard
      settings={shopifySettings}
      onSettingsRefresh={() => { refetchShopify(); refetchProducts(); }}
    />
  );
}
