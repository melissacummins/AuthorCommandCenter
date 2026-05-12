import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  Package, BarChart3, BookOpen, DollarSign,
  Sparkles, Wallet, Search, ArrowRight, Megaphone, Library
} from 'lucide-react';

const modules = [
  {
    name: 'Inventory & Orders',
    description: 'Track product stock, pull Shopify orders by location, and auto-update inventory from sales.',
    path: '/inventory',
    icon: Package,
    gradient: 'from-blue-500 to-blue-600',
    shadow: 'shadow-blue-500/25',
  },
  {
    name: 'Cross-Sell Analyzer',
    description: 'Upload Shopify CSVs to discover which products your customers buy together.',
    path: '/cross-sell',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-emerald-600',
    shadow: 'shadow-emerald-500/25',
  },
  {
    name: 'Catalog',
    description: 'Every book in one place: status, covers, ISBNs, series links, tropes, excerpts, and marketing copy.',
    path: '/catalog',
    icon: Library,
    gradient: 'from-indigo-500 to-violet-600',
    shadow: 'shadow-indigo-500/25',
  },
  {
    name: 'Book Tracker',
    description: 'Track development costs for each book and see when they pay for themselves.',
    path: '/book-tracker',
    icon: BookOpen,
    gradient: 'from-purple-500 to-purple-600',
    shadow: 'shadow-purple-500/25',
  },
  {
    name: 'Profit',
    description: 'Log daily ad spend and royalties across Amazon, Shopify, Kobo, and more.',
    path: '/profit-track',
    icon: DollarSign,
    gradient: 'from-green-500 to-green-600',
    shadow: 'shadow-green-500/25',
  },
  {
    name: 'Ad Alchemy',
    description: 'Analyze Facebook ad performance, identify winning hooks, and optimize creatives.',
    path: '/ad-alchemy',
    icon: Sparkles,
    gradient: 'from-orange-500 to-orange-600',
    shadow: 'shadow-orange-500/25',
  },
  {
    name: 'Marketing',
    description: 'Create ad copy, manage creatives, build reel scripts, and adapt content for social media.',
    path: '/marketing',
    icon: Megaphone,
    gradient: 'from-pink-500 to-pink-600',
    shadow: 'shadow-pink-500/25',
  },
  {
    name: 'Financials',
    description: 'Import bank transactions, auto-categorize expenses, and track subscriptions.',
    path: '/finstream',
    icon: Wallet,
    gradient: 'from-cyan-500 to-cyan-600',
    shadow: 'shadow-cyan-500/25',
  },
  {
    name: 'KDP Optimizer',
    description: 'Manage keyword lists, analyze competition, and generate optimized Amazon keyword boxes.',
    path: '/kdp-optimizer',
    icon: Search,
    gradient: 'from-rose-500 to-rose-600',
    shadow: 'shadow-rose-500/25',
  },
];

export default function Home() {
  const { profile, user } = useAuth();
  const firstName = (profile?.full_name || user?.user_metadata?.full_name || 'there').split(' ')[0];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">
          Welcome back, {firstName}!
        </h1>
        <p className="text-slate-500 mt-1">
          Your author business tools, all in one place.
        </p>
      </div>

      {/* Module Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {modules.map(module => {
          const Icon = module.icon;
          return (
            <Link
              key={module.path}
              to={module.path}
              className="group bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg hover:border-slate-300 transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br ${module.gradient} rounded-xl shadow-lg ${module.shadow}`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-1">{module.name}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{module.description}</p>
            </Link>
          );
        })}
      </div>

      {/* Info Banner */}
      <div className="mt-8 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6">
        <h3 className="font-semibold text-amber-800 mb-1">Data Migration</h3>
        <p className="text-sm text-amber-700">
          Each module includes import tools to bring in your existing data from your previous apps.
          Your old apps and their data remain untouched.
        </p>
      </div>
    </div>
  );
}
