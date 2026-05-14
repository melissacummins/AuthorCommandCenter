import { useMemo, useState } from 'react';
import { ArrowLeft, Save, Search } from 'lucide-react';
import type { Book } from '../../catalog/types';
import { updateKdpBook } from '../api';
import type { KdpBook, Keyword, ScoreColor, Trope } from '../types';
import { COLOR_CLASSES } from '../types';

interface Props {
  book: KdpBook;
  tropes: Trope[];
  keywords: Keyword[];
  catalogBooks: Book[];
  onBack: () => void;
  onSaved: (updated: KdpBook) => void;
}

const COLOR_DOT: Record<ScoreColor, string> = {
  Green: 'bg-emerald-500',
  Yellow: 'bg-amber-500',
  Red: 'bg-rose-500',
  Gray: 'bg-slate-400',
};

export default function BookOptimizer({ book, tropes, keywords, catalogBooks, onBack, onSaved }: Props) {
  const [draft, setDraft] = useState<KdpBook>(book);
  const [query, setQuery] = useState('');
  const [showOnlyAssigned, setShowOnlyAssigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tropeById = useMemo(() => {
    const m = new Map<string, Trope>();
    for (const t of tropes) m.set(t.id, t);
    return m;
  }, [tropes]);

  const assignedTropeSet = useMemo(() => new Set(draft.assigned_trope_ids), [draft.assigned_trope_ids]);
  const selectedKeywordSet = useMemo(() => new Set(draft.selected_keyword_ids), [draft.selected_keyword_ids]);

  // Group keywords by trope, sorted by trope name then keyword text.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, Keyword[]>();
    for (const k of keywords) {
      if (q && !k.text.toLowerCase().includes(q)) continue;
      if (showOnlyAssigned && !assignedTropeSet.has(k.trope_id)) continue;
      const arr = groups.get(k.trope_id) ?? [];
      arr.push(k);
      groups.set(k.trope_id, arr);
    }
    return Array.from(groups.entries())
      .map(([tropeId, list]) => ({
        trope: tropeById.get(tropeId),
        tropeId,
        keywords: list.sort((a, b) => a.text.localeCompare(b.text)),
      }))
      .filter(g => g.trope)
      .sort((a, b) => (a.trope!.name).localeCompare(b.trope!.name));
  }, [keywords, query, showOnlyAssigned, assignedTropeSet, tropeById]);

  function toggleTrope(id: string) {
    setDraft(d => {
      const set = new Set(d.assigned_trope_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, assigned_trope_ids: Array.from(set) };
    });
  }

  function toggleKeyword(id: string) {
    setDraft(d => {
      const set = new Set(d.selected_keyword_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, selected_keyword_ids: Array.from(set) };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateKdpBook(draft.id, {
        title: draft.title,
        subtitle: draft.subtitle,
        series: draft.series,
        amazon_categories: draft.amazon_categories,
        assigned_trope_ids: draft.assigned_trope_ids,
        selected_keyword_ids: draft.selected_keyword_ids,
        book_id: draft.book_id,
      });
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> Back to KDP books
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{draft.title}</h2>
            {draft.subtitle && <p className="text-sm text-slate-500">{draft.subtitle}</p>}
            {draft.series && <p className="text-xs text-indigo-600 font-medium mt-1">{draft.series}</p>}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg shadow-sm shrink-0"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Linked Catalog book</label>
            <select
              value={draft.book_id ?? ''}
              onChange={e => setDraft(d => ({ ...d, book_id: e.target.value || null }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">— Not linked —</option>
              {catalogBooks.map(b => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Amazon categories</label>
            <input
              value={draft.amazon_categories}
              onChange={e => setDraft(d => ({ ...d, amazon_categories: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <Stat label="Tropes assigned" value={assignedTropeSet.size} />
            <Stat label="Keywords selected" value={selectedKeywordSet.size} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white rounded-2xl border border-slate-200 p-3">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter keywords by text"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
          />
        </div>
        <label className="text-xs text-slate-600 flex items-center gap-2">
          <input
            type="checkbox"
            checked={showOnlyAssigned}
            onChange={e => setShowOnlyAssigned(e.target.checked)}
          />
          Only show assigned tropes
        </label>
      </div>

      {/* Grouped keywords */}
      <div className="space-y-3">
        {grouped.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 text-sm text-slate-500">
            No keywords match. Import data on the Import tab, or clear the filter.
          </div>
        )}
        {grouped.map(g => {
          const trope = g.trope!;
          const assigned = assignedTropeSet.has(trope.id);
          const selectedInGroup = g.keywords.filter(k => selectedKeywordSet.has(k.id)).length;
          return (
            <div key={trope.id} className="bg-white rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={assigned} onChange={() => toggleTrope(trope.id)} />
                  <span className="font-semibold text-slate-800">{trope.name}</span>
                </label>
                <span className="text-xs text-slate-500">
                  {selectedInGroup} / {g.keywords.length} selected
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {g.keywords.map(k => {
                  const selected = selectedKeywordSet.has(k.id);
                  return (
                    <label
                      key={k.id}
                      className={`flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer ${selected ? 'bg-indigo-50/40' : ''}`}
                    >
                      <input type="checkbox" checked={selected} onChange={() => toggleKeyword(k.id)} />
                      <span className="text-sm text-slate-800 flex-1 truncate">{k.text}</span>
                      <KeywordMetrics keyword={k} />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center bg-slate-50 rounded-lg px-2 py-1.5">
      <div className="text-lg font-bold text-slate-800 leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function KeywordMetrics({ keyword }: { keyword: Keyword }) {
  const sv = keyword.search_volume_color as ScoreColor | '';
  const cs = keyword.competitive_score_color as ScoreColor | '';
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
      <span className="hidden md:inline">
        Vol:{' '}
        {sv && <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${COLOR_DOT[sv]}`} />}
        <span className="font-medium text-slate-700">{keyword.search_volume.toLocaleString()}</span>
      </span>
      <span className="hidden md:inline">
        Comp:{' '}
        {cs && <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${COLOR_DOT[cs]}`} />}
        <span className="font-medium text-slate-700">{keyword.competitive_score}</span>
      </span>
      <span className="hidden lg:inline">
        ${keyword.avg_monthly_earnings.toLocaleString()}/mo
      </span>
    </div>
  );
}
