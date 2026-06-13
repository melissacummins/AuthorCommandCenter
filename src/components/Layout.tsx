import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { moduleKeyForPath } from '../lib/access';
import {
  LogOut, BookOpen, Package, BarChart3, DollarSign,
  Sparkles, Wallet, Search, Home, Menu, X, ChevronRight, PanelLeftClose, PanelLeftOpen, Megaphone, Settings, Link2, Library, Users, ImagePlus, Share2, Clock, NotebookPen, UserPlus
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

const modules = [
  { name: 'Home', path: '/', icon: Home, color: 'text-amber-400' },
  { name: 'Planner', path: '/planner', icon: NotebookPen, color: 'text-teal-400' },
  { name: 'Catalog', path: '/catalog', icon: Library, color: 'text-indigo-400' },
  { name: 'Timeline', path: '/timeline', icon: Clock, color: 'text-indigo-400' },
  { name: 'Book Tracker', path: '/book-tracker', icon: BookOpen, color: 'text-purple-400' },
  { name: 'Profit', path: '/profit-track', icon: DollarSign, color: 'text-green-400' },
  { name: 'Transactions', path: '/finstream', icon: Wallet, color: 'text-cyan-400' },
  { name: 'Inventory', path: '/inventory', icon: Package, color: 'text-blue-400' },
  { name: 'Cross-Sell Analyzer', path: '/cross-sell', icon: BarChart3, color: 'text-emerald-400' },
  { name: 'Ad Alchemy', path: '/ad-alchemy', icon: Sparkles, color: 'text-orange-400' },
  { name: 'Marketing', path: '/marketing', icon: Megaphone, color: 'text-pink-400' },
  { name: 'KDP Optimizer', path: '/kdp-optimizer', icon: Search, color: 'text-rose-400' },
  { name: 'Links', path: '/links', icon: Link2, color: 'text-indigo-400' },
  { name: 'ARCs', path: '/arcs', icon: Users, color: 'text-pink-400' },
  { name: 'BookFunnel', path: '/bookfunnel', icon: UserPlus, color: 'text-pink-400' },
  { name: 'Media', path: '/media', icon: ImagePlus, color: 'text-fuchsia-400' },
  { name: 'Social Media', path: '/social-media', icon: Share2, color: 'text-violet-400' },
  { name: 'Settings', path: '/settings', icon: Settings, color: 'text-slate-300' },
];

// Sidebar sections — each section header groups the module paths that
// follow it. Home and Settings live outside any section.
const sections: { label: string; paths: string[] }[] = [
  { label: 'Catalog',    paths: ['/catalog', '/timeline'] },
  { label: 'Finances',   paths: ['/book-tracker', '/profit-track', '/finstream'] },
  { label: 'Operations', paths: ['/inventory', '/cross-sell'] },
  { label: 'Marketing',  paths: ['/ad-alchemy', '/marketing', '/media', '/social-media', '/kdp-optimizer', '/links', '/arcs', '/bookfunnel'] },
];

const moduleByPath = Object.fromEntries(modules.map(m => [m.path, m]));
const homeModule = moduleByPath['/'];
const plannerModule = moduleByPath['/planner'];
const settingsModule = moduleByPath['/settings'];

type ModuleEntry = (typeof modules)[number];

function NavLink({
  module,
  collapsed,
  activePath,
  onNav,
}: {
  module: ModuleEntry;
  collapsed: boolean;
  activePath: string;
  onNav: () => void;
}) {
  const Icon = module.icon;
  const isActive = activePath === module.path;
  return (
    <Link
      to={module.path}
      onClick={onNav}
      title={collapsed ? module.name : undefined}
      className={`
        flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-xl transition-all group
        ${isActive ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}
      `}
    >
      <Icon className={`w-5 h-5 shrink-0 ${isActive ? module.color : 'text-slate-500 group-hover:text-slate-300'}`} />
      {!collapsed && <span className="font-medium text-sm">{module.name}</span>}
      {!collapsed && isActive && <ChevronRight className="w-4 h-4 ml-auto text-slate-500" />}
    </Link>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, profile, signOut, sidebarModules } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');

  // Only show areas the user is entitled to AND hasn't personally hidden.
  // A section disappears entirely once it has no visible modules.
  const visibleSections = sections
    .map(s => ({ ...s, paths: s.paths.filter(p => { const k = moduleKeyForPath(p); return k ? sidebarModules.has(k) : true; }) }))
    .filter(s => s.paths.length > 0);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  }

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email || 'User';
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const currentModule = modules.find(m => m.path === location.pathname) || modules[0];

  return (
    <div className="flex h-screen bg-slate-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        ${collapsed ? 'w-[68px]' : 'w-72'} bg-slate-900 flex flex-col
        transform transition-all duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Brand */}
        <div className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-6'} py-5 border-b border-slate-700/50`}>
          <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl shadow-lg shadow-amber-500/20 shrink-0">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <>
              <div>
                <h1 className="text-white font-bold text-lg leading-tight">Command Center</h1>
                <p className="text-slate-500 text-xs">Author Tools</p>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggleCollapsed}
          className="hidden lg:flex items-center justify-center py-2 text-slate-500 hover:text-white hover:bg-slate-800/50 transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 overflow-y-auto nice-scrollbar">
          <NavLink module={homeModule} collapsed={collapsed} activePath={location.pathname} onNav={() => setSidebarOpen(false)} />
          {/* Planner is a personal tool, always available and outside the four
              gated groups (like Home/Settings). */}
          <NavLink module={plannerModule} collapsed={collapsed} activePath={location.pathname} onNav={() => setSidebarOpen(false)} />

          {visibleSections.map(section => (
            <div key={section.label} className="mt-5">
              {!collapsed && (
                <div className="flex items-center gap-2 px-3 pb-2">
                  <div className="h-px flex-1 bg-slate-700/60" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400/70">
                    {section.label}
                  </span>
                  <div className="h-px flex-1 bg-slate-700/60" />
                </div>
              )}
              {collapsed && <div className="mx-3 my-3 border-t border-slate-700/50" />}
              <div className="space-y-1">
                {section.paths.map(path => {
                  const m = moduleByPath[path];
                  if (!m) return null;
                  return (
                    <NavLink
                      key={m.path}
                      module={m}
                      collapsed={collapsed}
                      activePath={location.pathname}
                      onNav={() => setSidebarOpen(false)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-4">
            {collapsed && <div className="mx-3 my-2 border-t border-slate-700/50" />}
            <NavLink module={settingsModule} collapsed={collapsed} activePath={location.pathname} onNav={() => setSidebarOpen(false)} />
          </div>
        </nav>

        {/* User */}
        <div className={`${collapsed ? 'px-2' : 'px-4'} py-4 border-t border-slate-700/50`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full ring-2 ring-slate-700 shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{displayName}</p>
                  <p className="text-slate-500 text-xs truncate">{user?.email}</p>
                </div>
                <button onClick={signOut} className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors" title="Sign Out">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="flex items-center gap-4 px-6 py-4 bg-white border-b border-slate-200 shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-600 hover:text-slate-900">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <currentModule.icon className={`w-5 h-5 ${currentModule.color}`} />
            <h2 className="text-lg font-semibold text-slate-800">{currentModule.name}</h2>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
