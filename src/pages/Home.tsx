import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { moduleKeyForPath } from '../lib/access';
import NeedsAttentionWidget from '../components/dashboard/NeedsAttentionWidget';
import OpenProjectsWidget from '../components/dashboard/OpenProjectsWidget';
import MonthPnlWidget from '../components/dashboard/MonthPnlWidget';
import OpportunitiesWidget from '../components/dashboard/OpportunitiesWidget';
import UpcomingWidget from '../components/dashboard/UpcomingWidget';
import RecentActivityWidget from '../components/dashboard/RecentActivityWidget';
import {
  Package, BarChart3, BookOpen, DollarSign,
  Clapperboard, Wallet, Search, ArrowRight, Library, Link2, Users, ImagePlus, Share2,
  ChevronDown, ChevronRight, AudioLines, Gift, PenTool,
} from 'lucide-react';

interface ModuleCard {
  name: string;
  description: string;
  path: string;
  icon: typeof Package;
}

const moduleByPath: Record<string, ModuleCard> = {
  '/catalog': {
    name: 'Catalog',
    description: 'Every book in one place: status, covers, ISBNs, series links, tropes, excerpts, and marketing copy.',
    path: '/catalog',
    icon: Library,
  },
  '/writing': {
    name: 'Writing',
    description: 'Import a manuscript, chapter by chapter, so the rest of the Command Center can use it.',
    path: '/writing',
    icon: PenTool,
  },
  '/book-tracker': {
    name: 'Book Tracker',
    description: 'Track development costs for each book and see when they pay for themselves.',
    path: '/book-tracker',
    icon: BookOpen,
  },
  '/profit-track': {
    name: 'Profit',
    description: 'Log daily ad spend and royalties across Amazon, Shopify, Kobo, and more.',
    path: '/profit-track',
    icon: DollarSign,
  },
  '/finstream': {
    name: 'Transactions',
    description: 'Import bank transactions, auto-categorize expenses, and track subscriptions.',
    path: '/finstream',
    icon: Wallet,
  },
  '/inventory': {
    name: 'Inventory & Orders',
    description: 'Track product stock, pull Shopify orders by location, and auto-update inventory from sales.',
    path: '/inventory',
    icon: Package,
  },
  '/cross-sell': {
    name: 'Cross-Sell Analyzer',
    description: 'Upload Shopify CSVs to discover which products your customers buy together.',
    path: '/cross-sell',
    icon: BarChart3,
  },
  '/upsells': {
    name: 'Upsells',
    description: 'Your own SellEasy: bundle and add-on offers on your Shopify product pages, immune to image changes.',
    path: '/upsells',
    icon: Gift,
  },
  '/content-creator': {
    name: 'Content Creator',
    description: 'Scan your manuscript for hooks, then turn them into slideshows, Kindle screenshots, and videos for ads and social.',
    path: '/content-creator',
    icon: Clapperboard,
  },
  '/kdp-optimizer': {
    name: 'KDP Optimizer',
    description: 'Manage keyword lists, analyze competition, and generate optimized Amazon keyword boxes.',
    path: '/kdp-optimizer',
    icon: Search,
  },
  '/links': {
    name: 'Links',
    description: 'Custom slugs, click tracking, archived links, and a hosted bio page.',
    path: '/links',
    icon: Link2,
  },
  '/arcs': {
    name: 'ARCs',
    description: 'Every ARC reader in one place — who got what, who reviewed, who is awaiting a copy.',
    path: '/arcs',
    icon: Users,
  },
  '/media': {
    name: 'Media',
    description: 'Generate Pinterest pins, new release art, social images, and short video clips with AI.',
    path: '/media',
    icon: ImagePlus,
  },
  '/social-media': {
    name: 'Social Media',
    description: 'Connect Pinterest, Instagram, TikTok, and more to track per-post stats and tie them back to the book they\'re promoting.',
    path: '/social-media',
    icon: Share2,
  },
  '/audiobook': {
    name: 'Audiobook',
    description: 'Turn a manuscript into multi-voice narration with ElevenLabs — AI tags who speaks each line, you correct it, then render.',
    path: '/audiobook',
    icon: AudioLines,
  },
};

const sections: { label: string; paths: string[] }[] = [
  { label: 'Catalog',    paths: ['/catalog', '/writing'] },
  { label: 'Finances',   paths: ['/book-tracker', '/profit-track', '/finstream'] },
  { label: 'Operations', paths: ['/inventory', '/cross-sell', '/upsells'] },
  { label: 'Marketing',  paths: ['/content-creator', '/media', '/social-media', '/audiobook', '/kdp-optimizer', '/links', '/arcs'] },
];

export default function Home() {
  const { profile, user, visibleModules } = useAuth();
  const firstName = (profile?.full_name || user?.user_metadata?.full_name || 'there').split(' ')[0];
  // The dashboard leads; module links are a collapsed drawer below it
  // (directive §4). Open state is remembered per browser.
  const [toolsOpen, setToolsOpen] = useState(() => localStorage.getItem('home-tools-open') === 'true');
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content">
          Welcome back, {firstName}!
        </h1>
        <p className="text-sm text-content-secondary mt-0.5">
          Here's where your author business stands today.
        </p>
      </div>

      {/* Status board — every widget loads independently (directive §4).
          Row 1: Needs Attention / Open Projects / Month P&L.
          Row 2: Opportunities / Upcoming / Recent Activity. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start mb-8">
        <NeedsAttentionWidget />
        <OpenProjectsWidget />
        <MonthPnlWidget />
        <OpportunitiesWidget />
        <UpcomingWidget />
        <RecentActivityWidget />
      </div>

      {visibleSections.length === 0 && (
        <div className="bg-surface rounded-card border border-edge p-8 text-center">
          <h3 className="font-semibold text-content mb-1">You're all set up</h3>
          <p className="text-sm text-content-secondary">
            Your tools are being switched on. Areas will appear here as they're released — check
            back soon.
          </p>
        </div>
      )}

      {visibleSections.length > 0 && (
        <button
          onClick={toggleTools}
          className="flex items-center gap-2 mb-4 text-content-secondary hover:text-content transition-colors"
        >
          {toolsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="text-xs font-semibold uppercase tracking-wider">Your tools</span>
        </button>
      )}

      {toolsOpen && visibleSections.map(section => (
        <section key={section.label} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary mb-3">
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
                  className="group bg-surface rounded-card border border-edge p-4 hover:shadow-md hover:border-edge-strong transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="inline-flex items-center justify-center w-10 h-10 bg-brand-100 text-brand-600 rounded-control shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-semibold text-content flex-1">{m.name}</h3>
                    <ArrowRight className="w-4 h-4 text-content-faint group-hover:text-content-secondary group-hover:translate-x-0.5 transition-all" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
