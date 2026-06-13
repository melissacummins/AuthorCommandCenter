import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PenNameProvider } from './contexts/PenNameContext';
import { GATED_MODULES } from './lib/access';
import Layout from './components/Layout';
import Login from './pages/Login';
import AccessGate from './pages/AccessGate';
import Home from './pages/Home';

// Each module is its own route and most users only ever open a handful, so we
// load them lazily. This keeps the initial bundle to the app shell (Layout +
// Home) and pulls each module's code only when its route is first visited.
const InventoryModule = lazy(() => import('./modules/inventory/InventoryModule'));
const CrossSellModule = lazy(() => import('./modules/cross-sell/CrossSellModule'));
const BookTrackerModule = lazy(() => import('./modules/book-tracker/BookTrackerModule'));
const CatalogModule = lazy(() => import('./modules/catalog/CatalogModule'));
const ProfitTrackModule = lazy(() => import('./modules/profit-track/ProfitTrackModule'));
const AdAlchemyModule = lazy(() => import('./modules/ad-alchemy/AdAlchemyModule'));
const MarketingModule = lazy(() => import('./modules/marketing/MarketingModule'));
const FinStreamModule = lazy(() => import('./modules/finstream/FinStreamModule'));
const KDPOptimizerModule = lazy(() => import('./modules/kdp-optimizer/KDPOptimizerModule'));
const LinkShortenerModule = lazy(() => import('./modules/link-shortener/LinkShortenerModule'));
const ARCsModule = lazy(() => import('./modules/arcs/ARCsModule'));
const BookFunnelModule = lazy(() => import('./modules/bookfunnel/BookFunnelModule'));
const MediaModule = lazy(() => import('./modules/media/MediaModule'));
const SocialMediaModule = lazy(() => import('./modules/social-media/SocialMediaModule'));
const SettingsModule = lazy(() => import('./modules/settings/SettingsModule'));
const TimelineModule = lazy(() => import('./modules/timeline/TimelineModule'));
const PlannerModule = lazy(() => import('./modules/planner/PlannerModule'));
const ShopifyCallback = lazy(() => import('./modules/orders/components/ShopifyCallback'));

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
  'bookfunnel': <BookFunnelModule />,
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
        <Suspense fallback={<ModuleFallback />}>
          <Routes>
            <Route index element={<Home />} />
            {GATED_MODULES.filter(m => visibleModules.has(m.key)).map(m => (
              <Route key={m.key} path={m.path.replace(/^\//, '')} element={GATED_ELEMENTS[m.key]} />
            ))}
            {/* Planner is always available (like Home/Settings) — it's a personal
                tool, not a sellable area, so it isn't gated and costs no module slot. */}
            <Route path="planner" element={<PlannerModule />} />
            <Route path="settings" element={<SettingsModule />} />
            <Route path="shopify/callback" element={<ShopifyCallback />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </PenNameProvider>
  );
}

// Shown briefly while a lazily-loaded module's chunk is fetched.
function ModuleFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
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
