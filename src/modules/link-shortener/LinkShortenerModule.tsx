import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Link2, BarChart3, Loader2, ExternalLink, Check } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { listClicks, listLinks } from './api';
import LinksTable from './components/LinksTable';
import CreateLinkModal from './components/CreateLinkModal';
import LinkDetailDrawer from './components/LinkDetailDrawer';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import { buildShortUrl, getShortLinkBase } from './utils';
import type { LinkClick, ShortLink } from './types';

type Tab = 'links' | 'analytics';

export default function LinkShortenerModule() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('links');
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [clicks, setClicks] = useState<LinkClick[]>([]);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<ShortLink | null>(null);
  const [selected, setSelected] = useState<ShortLink | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    listLinks(user.id)
      .then(setLinks)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load links'))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user || tab !== 'analytics') return;
    setLoadingAnalytics(true);
    listClicks(user.id, { sinceDays: rangeDays, limit: 10000 })
      .then(setClicks)
      .catch(() => setClicks([]))
      .finally(() => setLoadingAnalytics(false));
  }, [user, tab, rangeDays]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const baseDomain = useMemo(() => {
    const base = getShortLinkBase();
    try {
      return new URL(base).host;
    } catch {
      return base;
    }
  }, []);

  function handleCreated(link: ShortLink) {
    setLinks((prev) => [link, ...prev]);
    setToast(`Created ${buildShortUrl(link.slug)}`);
  }

  function handleUpdated(link: ShortLink) {
    setLinks((prev) => prev.map((l) => (l.id === link.id ? link : l)));
    setSelected(link);
  }

  function handleDeleted(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id && l.parent_id !== id));
    setSelected(null);
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <TabButton active={tab === 'links'} onClick={() => setTab('links')} icon={<Link2 className="w-4 h-4" />} label="Links" />
          <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 className="w-4 h-4" />} label="Analytics" />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="font-mono">{baseDomain}</span>
          </div>
          {tab === 'analytics' && (
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value))}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          )}
          <button
            onClick={() => {
              setCreateParent(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" /> New link
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : tab === 'links' ? (
        <LinksTable
          links={links}
          onSelect={setSelected}
          onCopied={(slug) => setToast(`Copied ${buildShortUrl(slug)}`)}
        />
      ) : loadingAnalytics ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <AnalyticsDashboard links={links} clicks={clicks} rangeDays={rangeDays} />
      )}

      {selected && (
        <LinkDetailDrawer
          link={selected}
          allLinks={links}
          onClose={() => setSelected(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onAddVariant={(parent) => {
            setCreateParent(parent);
            setCreateOpen(true);
          }}
        />
      )}

      <CreateLinkModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
        parent={createParent}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm shadow-xl z-50">
          <Check className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
