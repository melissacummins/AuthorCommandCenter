import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { moduleKeyForPath } from '../lib/access';
import TodayPanel from '../modules/planner/TodayPanel';
import {
  Package, BarChart3, BookOpen, DollarSign,
  Sparkles, Wallet, Search, ArrowRight, Megaphone, Library, Link2, Users, ImagePlus, Share2, Clock,
  ChevronDown, ChevronRight, AudioLines,
} from 'lucide-react';

interface ModuleCard {
  name: string;
  description: string;
  path: string;
  icon: typeof Package;
  gradient: string;
  shadow: string;
}

const moduleByPath: Record<string, ModuleCard> = {
  '/catalog': {
    name: 'Catalog',
    description: 'Every book in one place: status, covers, ISBNs, series links, tropes, excerpts, and marketing copy.',
    path: '/catalog',
    icon: Library,
    gradient: 'from-indigo-500 to-violet-600',
    shadow: 'shadow-indigo-500/25',
  },
  '/timeline': {
    name: 'Timeline',
    description: 'Per-book story of sales, ad spend, promos, newsletters, and launches in chronological order.',
    path: '/timeline',
    icon: Clock,
    gradient: 'from-indigo-500 to-blue-600',
    shadow: 'shadow-indigo-500/25',
  },
  '/book-tracker': {
    name: 'Book Tracker',
    description: 'Track development costs for each book and see when they pay for themselves.',
    path: '/book-tracker',
    icon: BookOpen,
    gradient: 'from-purple-500 to-purple-600',
    shadow: 'shadow-purple-500/25',
  },
  '/profit-track': {
    name: 'Profit',
    description: 'Log daily ad spend and royalties across Amazon, Shopify, Kobo, and more.',
    path: '/profit-track',
    icon: DollarSign,
    gradient: 'from-green-500 to-green-600',
    shadow: 'shadow-green-500/25',
  },
  '/finstream': {
    name: 'Transactions',
    description: 'Import bank transactions, auto-categorize expenses, and track subscriptions.',
    path: '/finstream',
    icon: Wallet,
    gradient: 'from-cyan-500 to-cyan-600',
    shadow: 'shadow-cyan-500/25',
  },
  '/inventory': {
    name: 'Inventory & Orders',
    description: 'Track product stock, pull Shopify orders by location, and auto-update inventory from sales.',
    path: '/inventory',
    icon: Package,
    gradient: 'from-blue-500 to-blue-600',
    shadow: 'shadow-blue-500/25',
  },
  '/cross-sell': {
    name: 'Cross-Sell Analyzer',
    description: 'Upload Shopify CSVs to discover which products your customers buy together.',
    path: '/cross-sell',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-emerald-600',
    shadow: 'shadow-emerald-500/25',
  },
  '/ad-alchemy': {
    name: 'Ad Alchemy',
    description: 'Analyze Facebook ad performance, identify winning hooks, and optimize creatives.',
    path: '/ad-alchemy',
    icon: Sparkles,
    gradient: 'from-orange-500 to-orange-600',
    shadow: 'shadow-orange-500/25',
  },
  '/marketing': {
    name: 'Marketing',
    description: 'Create ad copy, manage creatives, build reel scripts, and adapt content for social media.',
    path: '/marketing',
    icon: Megaphone,
    gradient: 'from-pink-500 to-pink-600',
    shadow: 'shadow-pink-500/25',
  },
  '/kdp-optimizer': {
    name: 'KDP Optimizer',
    description: 'Manage keyword lists, analyze competition, and generate optimized Amazon keyword boxes.',
    path: '/kdp-optimizer',
    icon: Search,
    gradient: 'from-rose-500 to-rose-600',
    shadow: 'shadow-rose-500/25',
  },
  '/links': {
    name: 'Links',
    description: 'Custom slugs, click tracking, archived links, and a hosted bio page.',
    path: '/links',
    icon: Link2,
    gradient: 'from-indigo-500 to-indigo-600',
    shadow: 'shadow-indigo-500/25',
  },
  '/arcs': {
    name: 'ARCs',
    description: 'Every ARC reader in one place — who got what, who reviewed, who is awaiting a copy.',
    path: '/arcs',
    icon: Users,
    gradient: 'from-pink-500 to-pink-600',
    shadow: 'shadow-pink-500/25',
  },
  '/media': {
    name: 'Media',
    description: 'Generate Pinterest pins, new release art, social images, and short video clips with AI.',
    path: '/media',
    icon: ImagePlus,
    gradient: 'from-fuchsia-500 to-purple-600',
    shadow: 'shadow-fuchsia-500/25',
  },
  '/social-media': {
    name: 'Social Media',
    description: 'Connect Pinterest, Instagram, TikTok, and more to track per-post stats and tie them back to the book they\'re promoting.',
    path: '/social-media',
    icon: Share2,
    gradient: 'from-violet-500 to-fuchsia-600',
    shadow: 'shadow-violet-500/25',
  },
  '/audiobook': {
    name: 'Audiobook',
    description: 'Turn a manuscript into multi-voice narration with ElevenLabs — AI tags who speaks each line, you correct it, then render.',
    path: '/audiobook',
    icon: AudioLines,
    gradient: 'from-fuchsia-500 to-purple-600',
    shadow: 'shadow-fuchsia-500/25',
  },
};

const sections: { label: string; paths: string[] }[] = [
  { label: 'Catalog',    paths: ['/catalog', '/timeline'] },
  { label: 'Finances',   paths: ['/book-tracker', '/profit-track', '/finstream'] },
  { label: 'Operations', paths: ['/inventory', '/cross-sell'] },
  { label: 'Marketing',  paths: ['/ad-alchemy', '/marketing', '/media', '/social-media', '/audiobook', '/kdp-optimizer', '/links', '/arcs'] },
];

export default function Home() {
  const { profile, user, visibleModules } = useAuth();
  const firstName = (profile?.full_name || user?.user_metadata?.full_name || 'there').split(' ')[0];
  // Tools take a back seat to the day's plan; collapse state is remembered so
  // the dashboard can stay focused on Today.
  const [toolsOpen, setToolsOpen] = useState(() => localStorage.getItem('home-tools-open') !== 'false');
  function toggleTools() {
    const next = !toolsOpen;
    setToolsOpen(next);
    localStorage.setItem('home-tools-open', String(next));
  }

  const visibleSections = sections
    .map(section => ({
      ...section,
      paths: section.paths.filter(p => { const k = moduleKeyForPath(p); return k ? visibleModules.has(k) : true; }),
    }))
    .filter(section => section.paths.length > 0);

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

      {/* Quick capture / today's plan — first thing you see on login. */}
      <TodayPanel />

      {visibleSections.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <h3 className="font-semibold text-slate-800 mb-1">You're all set up</h3>
          <p className="text-sm text-slate-500">
            Your tools are being switched on. Areas will appear here as they're released — check
            back soon.
          </p>
        </div>
      )}

      {visibleSections.length > 0 && (
        <button
          onClick={toggleTools}
          className="flex items-center gap-2 mb-4 text-slate-500 hover:text-slate-700 transition-colors"
        >
          {toolsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="text-xs font-semibold uppercase tracking-wider">Your tools</span>
        </button>
      )}

      {toolsOpen && visibleSections.map(section => (
        <section key={section.label} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            {section.label}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {section.paths.map(path => {
              const m = moduleByPath[path];
              if (!m) return null;
              const Icon = m.icon;
              return (
                <Link
                  key={m.path}
                  to={m.path}
                  className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:border-slate-300 transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex items-center justify-center w-10 h-10 bg-gradient-to-br ${m.gradient} rounded-lg shadow ${m.shadow} shrink-0`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 flex-1">{m.name}</h3>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {/* Info Banner */}
      {visibleSections.length > 0 && (
        <div className="mt-8 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6">
          <h3 className="font-semibold text-amber-800 mb-1">Data Migration</h3>
          <p className="text-sm text-amber-700">
            Each module includes import tools to bring in your existing data from your previous apps.
            Your old apps and their data remain untouched.
          </p>
        </div>
      )}
    </div>
  );
}
