import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PenNameProvider } from './contexts/PenNameContext';
import { GATED_MODULES } from './lib/access';
import Layout from './components/Layout';
import Login from './pages/Login';
import AccessGate from './pages/AccessGate';
import Home from './pages/Home';
import InventoryModule from './modules/inventory/InventoryModule';
import CrossSellModule from './modules/cross-sell/CrossSellModule';
import BookTrackerModule from './modules/book-tracker/BookTrackerModule';
import CatalogModule from './modules/catalog/CatalogModule';
import ProfitTrackModule from './modules/profit-track/ProfitTrackModule';
import AdAlchemyModule from './modules/ad-alchemy/AdAlchemyModule';
import MarketingModule from './modules/marketing/MarketingModule';
import FinStreamModule from './modules/finstream/FinStreamModule';
import KDPOptimizerModule from './modules/kdp-optimizer/KDPOptimizerModule';
import LinkShortenerModule from './modules/link-shortener/LinkShortenerModule';
import ARCsModule from './modules/arcs/ARCsModule';
import MediaModule from './modules/media/MediaModule';
import SocialMediaModule from './modules/social-media/SocialMediaModule';
import SettingsModule from './modules/settings/SettingsModule';
import TimelineModule from './modules/timeline/TimelineModule';
import ShopifyCallback from './modules/orders/components/ShopifyCallback';

// Maps each gateable module key to its route element. Keys match GATED_MODULES.
const GATED_ELEMENTS: Record<string, ReactElement> = {
  'catalog': <CatalogModule />,
  'timeline': <TimelineModule />,
  'book-tracker': <BookTrackerModule />,
  'profit-track': <ProfitTrackModule />,
  'finstream': <FinStreamModule />,
  'inventory': <InventoryModule />,
  'cross-sell': <CrossSellModule />,
  'ad-alchemy': <AdAlchemyModule />,
  'marketing': <MarketingModule />,
  'kdp-optimizer': <KDPOptimizerModule />,
  'links': <LinkShortenerModule />,
  'arcs': <ARCsModule />,
  'media': <MediaModule />,
  'social-media': <SocialMediaModule />,
};

function ProtectedRoutes() {
  const { user, loading, accessLoading, hasAccess, visibleModules } = useAuth();

  if (loading || (user && accessLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAccess) {
    return <AccessGate />;
  }

  return (
    <PenNameProvider>
      <Layout>
        <Routes>
          <Route index element={<Home />} />
          {GATED_MODULES.filter(m => visibleModules.has(m.key)).map(m => (
            <Route key={m.key} path={m.path.replace(/^\//, '')} element={GATED_ELEMENTS[m.key]} />
          ))}
          <Route path="settings" element={<SettingsModule />} />
          <Route path="shopify/callback" element={<ShopifyCallback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </PenNameProvider>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
