import { Copy, ExternalLink, Search, ChevronRight, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ShortLink } from '../types';
import { buildShortUrl, formatNumber, timeAgo } from '../utils';

interface Props {
  links: ShortLink[];
  onSelect: (link: ShortLink) => void;
  onCopied?: (slug: string) => void;
}

export default function LinksTable({ links, onSelect, onCopied }: Props) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const parents = useMemo(() => links.filter((l) => !l.parent_id), [links]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ShortLink[]>();
    for (const l of links) {
      if (l.parent_id) {
        const existing = map.get(l.parent_id) ?? [];
        existing.push(l);
        map.set(l.parent_id, existing);
      }
    }
    return map;
  }, [links]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parents.filter((l) => {
      if (!showArchived && (l.archived_at || !l.is_active)) return false;
      if (!q) return true;
      const haystack = [
        l.slug,
        l.label,
        l.destination_url,
        l.channel,
        ...(l.tags ?? []),
      ].join(' ').toLowerCase();
      const childMatch = (childrenByParent.get(l.id) ?? []).some((c) =>
        [c.slug, c.label, c.channel].join(' ').toLowerCase().includes(q),
      );
      return haystack.includes(q) || childMatch;
    });
  }, [parents, query, showArchived, childrenByParent]);

  async function copyUrl(slug: string) {
    try {
      await navigator.clipboard.writeText(buildShortUrl(slug));
      onCopied?.(slug);
    } catch {
      // ignore
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-200">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search slug, label, URL, channel…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded text-indigo-600" />
          Show archived / inactive
        </label>
      </div>

      <div className="divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            {query ? 'No links match your search.' : 'No links yet — create your first short link.'}
          </div>
        ) : (
          filtered.map((link) => {
            const kids = childrenByParent.get(link.id) ?? [];
            return (
              <div key={link.id}>
                <Row link={link} onSelect={onSelect} onCopy={copyUrl} />
                {kids.length > 0 && (
                  <div className="bg-slate-50/50 border-t border-slate-100">
                    {kids.map((child) => (
                      <div key={child.id}>
                        <Row link={child} onSelect={onSelect} onCopy={copyUrl} indent />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface RowProps {
  link: ShortLink;
  onSelect: (l: ShortLink) => void;
  onCopy: (slug: string) => void;
  indent?: boolean;
}

function Row({ link, onSelect, onCopy, indent }: RowProps) {
  const inactive = !link.is_active || !!link.archived_at;
  return (
    <div
      onClick={() => onSelect(link)}
      className={`flex items-center gap-3 px-5 py-3 hover:bg-indigo-50/40 cursor-pointer transition-colors ${indent ? 'pl-12' : ''} ${inactive ? 'opacity-60' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold text-indigo-600">/{link.slug}</span>
          {link.channel && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
              <Tag className="w-3 h-3" />
              {link.channel}
            </span>
          )}
          {inactive && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">inactive</span>
          )}
          {link.label && <span className="text-sm text-slate-700 truncate">{link.label}</span>}
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5">→ {link.destination_url}</div>
      </div>

      <div className="hidden md:flex flex-col items-end text-right shrink-0">
        <div className="text-sm font-semibold text-slate-700 tabular-nums">{formatNumber(link.click_count)}</div>
        <div className="text-xs text-slate-400">clicks · {timeAgo(link.last_clicked_at)}</div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy(link.slug);
          }}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg"
          title="Copy short URL"
        >
          <Copy className="w-4 h-4" />
        </button>
        <a
          href={link.destination_url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg"
          title="Open destination"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <ChevronRight className="w-4 h-4 text-slate-300" />
      </div>
    </div>
  );
}
