import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, List, Plus, ShoppingCart, Settings, Store, Truck, BookOpen, FileSpreadsheet } from 'lucide-react';
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
        <div className="flex gap-1 bg-surface-sunken rounded-control p-1 overflow-x-auto max-w-full [&_button]:whitespace-nowrap [&_button]:shrink-0">
          <button
            onClick={() => setTab('dashboard')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'dashboard' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </button>
          <button
            onClick={() => setTab('products')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'products' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <List className="w-4 h-4" /> Products
          </button>
          <button
            onClick={() => setTab('book-specs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'book-specs' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <BookOpen className="w-4 h-4" /> Book Specs
          </button>
          <button
            onClick={() => setTab('printer-quotes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'printer-quotes' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" /> Printer Quotes
          </button>
          <button
            onClick={() => setTab('purchase-orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'purchase-orders' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <Truck className="w-4 h-4" /> Purchase Orders
          </button>
          <button
            onClick={() => setTab('orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-control text-sm font-medium transition-colors ${
              tab === 'orders' ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'
            }`}
          >
            <ShoppingCart className="w-4 h-4" /> Shopify
          </button>
        </div>

        <div className="flex gap-2">
          {tab === 'orders' && shopifySettings?.access_token && (
            <Link
              to="/settings"
              className="flex items-center gap-2 px-4 py-2 border border-edge text-content text-sm font-medium rounded-control hover:bg-surface-hover"
            >
              <Settings className="w-4 h-4" /> Shopify Settings
            </Link>
          )}
          {(tab === 'dashboard' || tab === 'products') && (
            <button
              onClick={() => setShowAddProduct(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-control hover:bg-blue-700 shadow-sm"
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

  // Not connected — the connection now lives in Settings so every
  // Shopify-powered module manages it from one place.
  if (!shopifySettings || !shopifySettings.access_token) {
    return (
      <div className="max-w-3xl">
        <div className="bg-surface rounded-card border border-edge p-6">
          <h3 className="font-semibold text-content mb-1">Connect Your Shopify Store</h3>
          <p className="text-sm text-content-secondary mb-6">
            Pull orders directly from Shopify by fulfillment location and automatically update your
            inventory. The Shopify connection is managed in Settings and shared by all modules.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-control hover:bg-indigo-700"
          >
            <Store className="w-4 h-4" /> Connect Shopify in Settings
          </Link>
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
