import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Plus, Link2, BarChart3, Loader2, ExternalLink, Check, Settings2, X, Layout, Globe,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  deleteLink as apiDeleteLink, getPrimaryDomain, listClicks, listFolders, listLinks, updateLink,
} from './api';
import DomainSettings from './components/DomainSettings';
import LinksTable from './components/LinksTable';
import CreateLinkModal from './components/CreateLinkModal';
import LinkDetailDrawer from './components/LinkDetailDrawer';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import FoldersSidebar from './components/FoldersSidebar';
import QRCodeBlock from './components/QRCodeBlock';
import AttributionSetupModal from './components/AttributionSetupModal';
import BioPagePanel from './components/BioPagePanel';
import { buildShortUrl, setShortLinkBase, shortHostname } from './utils';
import type { LinkClick, LinkFolder, ShortLink } from './types';

type Tab = 'links' | 'analytics' | 'bio' | 'domain';

export default function LinkShortenerModule() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('links');
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [folders, setFolders] = useState<LinkFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | 'unassigned'>(null);
  const [clicks, setClicks] = useState<LinkClick[]>([]);
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<ShortLink | null>(null);
  const [selected, setSelected] = useState<ShortLink | null>(null);
  const [qrLink, setQrLink] = useState<ShortLink | null>(null);
  const [attribOpen, setAttribOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([listLinks(user.id), listFolders(user.id)])
      .then(([l, f]) => {
        setLinks(l);
        setFolders(f);
      })
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

  const [baseDomain, setBaseDomain] = useState(() => shortHostname());

  // Point copied short URLs at the user's own verified domain (if any) rather
  // than a global default, so each member sees their own brand.
  const refreshBase = useCallback(() => {
    if (!user) return;
    getPrimaryDomain(user.id)
      .then((domain) => {
        setShortLinkBase(domain ? `https://${domain}` : `${window.location.origin}/l`);
        setBaseDomain(shortHostname());
      })
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    refreshBase();
  }, [refreshBase]);

  function handleCreated(link: ShortLink) {
    setLinks((prev) => [link, ...prev]);
    setToast(`Created ${buildShortUrl(link.slug)}`);
  }

  function handleUpdated(link: ShortLink) {
    setLinks((prev) => prev.map((l) => (l.id === link.id ? link : l)));
    if (selected?.id === link.id) setSelected(link);
  }

  function handleDeleted(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id && l.parent_id !== id));
    setSelected(null);
  }

  async function copyToClipboard(slug: string) {
    try {
      await navigator.clipboard.writeText(buildShortUrl(slug));
      setToast(`Copied ${buildShortUrl(slug)}`);
    } catch {
      // ignore
    }
  }

  async function handleToggleActive(link: ShortLink) {
    try {
      const updated = await updateLink(link.id, { is_active: !link.is_active });
      handleUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  }

  async function handleDelete(link: ShortLink) {
    if (!confirm(`Delete /${link.slug}? This removes all click and conversion data for this link.`)) return;
    try {
      await apiDeleteLink(link.id);
      handleDeleted(link.id);
      setToast(`Deleted /${link.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          <TabButton active={tab === 'links'} onClick={() => setTab('links')} icon={<Link2 className="w-4 h-4" />} label="Links" />
          <TabButton active={tab === 'bio'} onClick={() => setTab('bio')} icon={<Layout className="w-4 h-4" />} label="Bio page" />
          <TabButton active={tab === 'domain'} onClick={() => setTab('domain')} icon={<Globe className="w-4 h-4" />} label="Domain" />
          <TabButton active={tab === 'analytics'} onClick={() => setTab('analytics')} icon={<BarChart3 className="w-4 h-4" />} label="Analytics" />
        </div>

        <div className="flex items-center gap-2">
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
            onClick={() => setAttribOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm"
            title="Conversion tracking setup"
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Conversions</span>
          </button>
          <button
            onClick={() => {
              setCreateParent(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm"
          >
            <Plus className="w-4 h-4" /> Create link
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
        <div className="flex flex-col lg:flex-row gap-6">
          <FoldersSidebar
            folders={folders}
            links={links}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onChange={setFolders}
          />
          <div className="flex-1 min-w-0">
            <LinksTable
              links={links}
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelect={setSelected}
              onCopy={copyToClipboard}
              onAddVariant={(parent) => {
                setCreateParent(parent);
                setCreateOpen(true);
              }}
              onShowQr={setQrLink}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete}
            />
          </div>
        </div>
      ) : tab === 'bio' ? (
        <BioPagePanel links={links} onUpdated={handleUpdated} />
      ) : tab === 'domain' ? (
        <DomainSettings onPrimaryChange={refreshBase} />
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
          folders={folders}
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
        folders={folders}
        defaultFolderId={selectedFolderId && selectedFolderId !== 'unassigned' ? selectedFolderId : null}
      />

      <AttributionSetupModal open={attribOpen} onClose={() => setAttribOpen(false)} />

      {qrLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setQrLink(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <button onClick={() => setQrLink(null)} className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-base font-semibold text-slate-800 mb-1">QR code</h3>
            <p className="text-xs text-slate-500 mb-4 truncate">/{qrLink.slug}</p>
            <QRCodeBlock url={buildShortUrl(qrLink.slug)} filename={`qr-${qrLink.slug}`} />
          </div>
        </div>
      )}

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
