import { Package, AlertTriangle, TrendingUp, DollarSign, RefreshCw, Plus, Search } from 'lucide-react';
import type { Product } from '../../../lib/types';
import { useAuth } from '../../../contexts/AuthContext';
import { calculateProductMetrics, formatCurrency, formatPercent, marginColor } from '../utils';
import { useSalesRates } from '../hooks/useSalesRates';

interface DashboardProps {
  products: Product[];
  onAddProduct: () => void;
  onAdjustStock: () => void;
}

export default function Dashboard({ products, onAddProduct, onAdjustStock }: DashboardProps) {
  const { profile, user } = useAuth();
  const firstName = (profile?.full_name || user?.user_metadata?.full_name || 'there').split(' ')[0];

  const { rates: salesRates } = useSalesRates(180);
  const enriched = products.map(p => {
    const sku = (p.sku || '').trim().toUpperCase();
    const shopifyDaily = sku ? salesRates.get(sku)?.avgDaily : undefined;
    return { ...p, metrics: calculateProductMetrics(p, products, shopifyDaily) };
  });

  const totalProducts = products.length;
  const totalInventory = enriched.reduce((sum, p) => {
    const inv = (p.category === 'Bundle' || p.category === 'Book Box') ? p.metrics.bundlesInventory : p.metrics.bookInventory;
    return sum + inv;
  }, 0);
  const needReorder = enriched.filter(p => p.metrics.status === 'REORDER NOW' || p.metrics.status === 'OUT OF STOCK').length;
  const avgMargin = products.length > 0
    ? enriched.reduce((sum, p) => sum + p.metrics.netMarginPercent, 0) / products.length
    : 0;

  const reorderProducts = enriched
    .filter(p => p.metrics.status === 'REORDER NOW' || p.metrics.status === 'OUT OF STOCK')
    .sort((a, b) => a.metrics.daysRemaining - b.metrics.daysRemaining);

  const estimatedReorderCost = reorderProducts.reduce((sum, p) => sum + p.metrics.reorderCost, 0);

  const topInventory = [...enriched]
    .filter(p => p.category !== 'Bundle')
    .sort((a, b) => b.metrics.bookInventory - a.metrics.bookInventory)
    .slice(0, 8);

  const maxInventory = topInventory.length > 0 ? topInventory[0].book_inventory : 1;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-card p-6 lg:p-8 text-white">
        <h2 className="text-2xl lg:text-3xl font-bold mb-1">{greeting}, {firstName}</h2>
        <p className="text-blue-100 mb-6">Here's what's happening with your inventory today.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Products', value: totalProducts, icon: Package, badge: null },
            { label: 'Total Inventory', value: totalInventory.toLocaleString(), icon: Package, badge: null },
            { label: 'Need Reorder', value: needReorder, icon: RefreshCw, badge: needReorder > 0 ? 'Action Needed' : null },
            { label: 'Avg Margin', value: formatPercent(avgMargin), icon: Search, badge: null },
          ].map(stat => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="bg-surface/15 backdrop-blur-sm rounded-card p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-9 h-9 bg-surface/20 rounded-control flex items-center justify-center">
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm text-blue-100">{stat.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  {stat.badge && (
                    <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-medium">{stat.badge}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reorder Alert Banner */}
      {reorderProducts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-card p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-700">{reorderProducts.length} product{reorderProducts.length !== 1 ? 's' : ''} need reordering</p>
            <p className="text-sm text-red-600">Estimated reorder cost: {formatCurrency(estimatedReorderCost)}</p>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-surface rounded-card border border-edge p-5">
        <h3 className="font-semibold text-content mb-1">Quick Actions</h3>
        <p className="text-sm text-content-secondary mb-4">Frequently used tools</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={onAdjustStock}
            className="flex items-center gap-3 p-4 border border-edge rounded-card hover:bg-surface-hover transition-colors text-left group"
          >
            <div className="w-10 h-10 bg-blue-50 rounded-control flex items-center justify-center group-hover:bg-blue-100">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-content text-sm">Update Stock</p>
              <p className="text-xs text-content-secondary">Add or subtract inventory</p>
            </div>
            <Plus className="w-4 h-4 text-content-faint ml-auto" />
          </button>
          <button
            onClick={onAddProduct}
            className="flex items-center gap-3 p-4 border border-edge rounded-card hover:bg-surface-hover transition-colors text-left group"
          >
            <div className="w-10 h-10 bg-green-50 rounded-control flex items-center justify-center group-hover:bg-green-100">
              <Plus className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-content text-sm">New Product</p>
              <p className="text-xs text-content-secondary">Add to your catalog</p>
            </div>
            <Plus className="w-4 h-4 text-content-faint ml-auto" />
          </button>
          <button
            onClick={onAdjustStock}
            className="flex items-center gap-3 p-4 border border-edge rounded-card hover:bg-surface-hover transition-colors text-left group"
          >
            <div className="w-10 h-10 bg-amber-50 rounded-control flex items-center justify-center group-hover:bg-amber-100">
              <RefreshCw className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="font-medium text-content text-sm">Reconcile</p>
              <p className="text-xs text-content-secondary">Reset stock levels</p>
            </div>
            <Plus className="w-4 h-4 text-content-faint ml-auto" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reorder Alerts Detail */}
        <div className="bg-surface rounded-card border border-edge p-5">
          <h3 className="font-semibold text-content mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Reorder Alerts
          </h3>
          {reorderProducts.length === 0 ? (
            <p className="text-sm text-content-secondary">All stock levels are healthy.</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {reorderProducts.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-red-50 rounded-control border border-red-100">
                  <div>
                    <p className="font-medium text-content text-sm">{p.name}</p>
                    <p className="text-xs text-content-secondary">{p.category} &middot; {p.metrics.bookInventory} in stock</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">
                      {p.metrics.daysRemaining === Infinity ? '—' : `${Math.round(p.metrics.daysRemaining)}d left`}
                    </p>
                    <p className="text-xs text-content-secondary">Threshold: {p.metrics.reorderThreshold}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Inventory */}
        <div className="bg-surface rounded-card border border-edge p-5">
          <h3 className="font-semibold text-content mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            Top Inventory Levels
          </h3>
          {topInventory.length === 0 ? (
            <p className="text-sm text-content-secondary">No products yet.</p>
          ) : (
            <div className="space-y-3">
              {topInventory.map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="w-28 text-xs text-content-secondary truncate shrink-0" title={p.name}>{p.name}</div>
                  <div className="flex-1 bg-surface-sunken rounded-full h-5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all flex items-center justify-end pr-2"
                      style={{ width: `${Math.max(8, (p.metrics.bookInventory / maxInventory) * 100)}%` }}
                    >
                      <span className="text-[10px] text-white font-medium">{p.metrics.bookInventory}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
