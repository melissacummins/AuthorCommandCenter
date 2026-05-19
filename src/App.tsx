import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
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
import ShopifyCallback from './modules/orders/components/ShopifyCallback';

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
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

  return (
    <Layout>
      <Routes>
        <Route index element={<Home />} />
        <Route path="inventory" element={<InventoryModule />} />
        <Route path="cross-sell" element={<CrossSellModule />} />
        <Route path="book-tracker" element={<BookTrackerModule />} />
        <Route path="catalog" element={<CatalogModule />} />
        <Route path="profit-track" element={<ProfitTrackModule />} />
        <Route path="ad-alchemy" element={<AdAlchemyModule />} />
        <Route path="marketing" element={<MarketingModule />} />
        <Route path="finstream" element={<FinStreamModule />} />
        <Route path="kdp-optimizer" element={<KDPOptimizerModule />} />
        <Route path="links" element={<LinkShortenerModule />} />
        <Route path="arcs" element={<ARCsModule />} />
        <Route path="media" element={<MediaModule />} />
        <Route path="social-media" element={<SocialMediaModule />} />
        <Route path="settings" element={<SettingsModule />} />
        <Route path="shopify/callback" element={<ShopifyCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
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
