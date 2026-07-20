import { useMemo, useState, type ReactNode } from 'react';
import { Filter, ArrowUpDown, Search } from 'lucide-react';
import LinkCard from './LinkCard';
import type { LinkFolder, ShortLink } from '../types';
import { linkStatus } from '../utils';

type StatusFilter = 'all' | 'live' | 'scheduled' | 'expired' | 'inactive' | 'archived';
type SortKey = 'newest' | 'oldest' | 'most_clicked' | 'most_revenue';

interface Props {
  links: ShortLink[];
  folders: LinkFolder[];
  selectedFolderId: string | null | 'unassigned';
  onSelect: (link: ShortLink) => void;
  onCopy: (slug: string) => void;
  onAddVariant: (parent: ShortLink) => void;
  onShowQr: (link: ShortLink) => void;
  onToggleActive: (link: ShortLink) => void;
  onDelete: (link: ShortLink) => void;
}

export default function LinksTable({
  links, folders, selectedFolderId, onSelect, onCopy,
  onAddVariant, onShowQr, onToggleActive, onDelete,
}: Props) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const parents = useMemo(() => links.filter((l) => !l.parent_id), [links]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ShortLink[]>();
    for (const l of links) {
      if (l.parent_id) {
        const list = map.get(l.parent_id) ?? [];
        list.push(l);
        map.set(l.parent_id, list);
      }
    }
    return map;
  }, [links]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = parents.filter((l) => {
      if (selectedFolderId === 'unassigned' && l.folder_id) return false;
      if (selectedFolderId && selectedFolderId !== 'unassigned' && l.folder_id !== selectedFolderId) return false;
      if (statusFilter !== 'all') {
        const status = linkStatus(l);
        if (status.tone !== statusFilter) return false;
      } else {
        if (l.archived_at) return false;
      }
      if (!q) return true;
      const haystack = [l.slug, l.label, l.destination_url, l.channel, ...(l.tags ?? [])].join(' ').toLowerCase();
      const childMatch = (childrenByParent.get(l.id) ?? []).some((c) =>
        [c.slug, c.label, c.channel].join(' ').toLowerCase().includes(q),
      );
      return haystack.includes(q) || childMatch;
    });

    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'most_clicked':
          return b.click_count - a.click_count;
        case 'most_revenue':
          return b.conversion_value - a.conversion_value;
        case 'newest':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return result;
  }, [parents, query, selectedFolderId, statusFilter, sortKey, childrenByParent]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropDown
          label={statusFilter === 'all' ? 'Filter' : `Filter: ${statusFilter}`}
          icon={<Filter className="w-3.5 h-3.5" />}
          open={filterOpen}
          onToggle={() => {
            setFilterOpen((v) => !v);
            setSortOpen(false);
          }}
        >
          {(['all', 'live', 'scheduled', 'expired', 'inactive', 'archived'] as StatusFilter[]).map((s) => (
            <div key={s}>
              <DropOption
                active={statusFilter === s}
                onClick={() => {
                  setStatusFilter(s);
                  setFilterOpen(false);
                }}
              >
                {s === 'all' ? 'All active' : s.charAt(0).toUpperCase() + s.slice(1)}
              </DropOption>
            </div>
          ))}
        </DropDown>

        <DropDown
          label={`Display: ${SORT_LABEL[sortKey]}`}
          icon={<ArrowUpDown className="w-3.5 h-3.5" />}
          open={sortOpen}
          onToggle={() => {
            setSortOpen((v) => !v);
            setFilterOpen(false);
          }}
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((s) => (
            <div key={s}>
              <DropOption
                active={sortKey === s}
                onClick={() => {
                  setSortKey(s);
                  setSortOpen(false);
                }}
              >
                {SORT_LABEL[s]}
              </DropOption>
            </div>
          ))}
        </DropDown>

        <div className="relative flex-1 min-w-[200px] max-w-md ml-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by short link or URL"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-control border border-edge bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface rounded-card border border-edge px-6 py-16 text-center">
          <div className="text-sm text-content-secondary">
            {query
              ? 'No links match your search.'
              : selectedFolderId === 'unassigned'
              ? 'No links in this view.'
              : 'No links yet — create your first short link.'}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((link) => (
            <div key={link.id}>
              <LinkCard
                link={link}
                variants={childrenByParent.get(link.id) ?? []}
                folders={folders}
                expanded={expanded.has(link.id)}
                onToggleExpand={() => toggleExpand(link.id)}
                onSelect={onSelect}
                onCopy={onCopy}
                onAddVariant={onAddVariant}
                onShowQr={onShowQr}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SORT_LABEL: Record<SortKey, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  most_clicked: 'Most clicks',
  most_revenue: 'Most revenue',
};

interface DropDownProps {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function DropDown({ label, icon, open, onToggle, children }: DropDownProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-control bg-surface border border-edge text-content hover:bg-surface-hover"
      >
        {icon}
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="absolute left-0 top-10 z-40 min-w-[180px] bg-surface rounded-card border border-edge shadow-lg py-1 text-sm">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

interface DropOptionProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function DropOption({ active, onClick, children }: DropOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 ${active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-content hover:bg-surface-hover'}`}
    >
      {children}
    </button>
  );
}
