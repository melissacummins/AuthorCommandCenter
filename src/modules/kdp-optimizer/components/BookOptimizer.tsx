import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, Save, Search } from 'lucide-react';
import type { Book } from '../../catalog/types';
import { updateKdpBook } from '../api';
import type { KdpBook, Keyword, ScoreColor, Trope } from '../types';
import { isFullyCovered, keywordWords, normalizeWords, packAmazonBoxes } from '../utils';

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

const VOL_CHIP: Record<ScoreColor, string> = {
  Green: 'bg-emerald-100 text-emerald-800',
  Yellow: 'bg-amber-100 text-amber-800',
  Red: 'bg-rose-100 text-rose-800',
  Gray: 'bg-slate-100 text-slate-600',
};

export default function BookOptimizer({
  book, tropes, keywords, catalogBooks, onBack, onSaved,
}: Props) {
  const [draft, setDraft] = useState<KdpBook>(book);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssignTropes, setShowAssignTropes] = useState(false);

  const assignedTropeSet = useMemo(() => new Set(draft.assigned_trope_ids), [draft.assigned_trope_ids]);
  const selectedKeywordSet = useMemo(() => new Set(draft.selected_keyword_ids), [draft.selected_keyword_ids]);

  const tropeById = useMemo(() => {
    const m = new Map<string, Trope>();
    for (const t of tropes) m.set(t.id, t);
    return m;
  }, [tropes]);

  // Words that Amazon already indexes from the book's metadata —
  // anything in the title/subtitle/series/categories is "covered" and
  // shouldn't take up space in the 7-box.
  const metadataCovered = useMemo(
    () => normalizeWords(draft.title, draft.subtitle, draft.series, draft.amazon_categories),
    [draft.title, draft.subtitle, draft.series, draft.amazon_categories],
  );

  // Available keywords = every keyword belonging to an assigned trope,
  // deduped by lowercase text across tropes (so "Curvy Girl" and
  // "Curvy Girl Romance" only appear once).
  const available = useMemo(() => {
    const seen = new Set<string>();
    const out: Keyword[] = [];
    for (const k of keywords) {
      if (!assignedTropeSet.has(k.trope_id)) continue;
      const key = k.text.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(k);
    }
    out.sort((a, b) => b.search_volume - a.search_volume);
    return out;
  }, [keywords, assignedTropeSet]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(k => k.text.toLowerCase().includes(q));
  }, [available, query]);

  // Selected keywords as full Keyword rows (in case some referenced IDs
  // aren't currently in the available list).
  const selectedRows = useMemo(() => {
    const idToKw = new Map(keywords.map(k => [k.id, k]));
    return draft.selected_keyword_ids
      .map(id => idToKw.get(id))
      .filter((k): k is Keyword => Boolean(k));
  }, [keywords, draft.selected_keyword_ids]);

  const totalSearchVolume = selectedRows.reduce((sum, k) => sum + (k.search_volume || 0), 0);
  const packResult = useMemo(() => packAmazonBoxes(selectedRows, metadataCovered), [selectedRows, metadataCovered]);

  function toggleKeyword(id: string) {
    setDraft(d => {
      const set = new Set(d.selected_keyword_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, selected_keyword_ids: Array.from(set) };
    });
  }

  function toggleTrope(id: string) {
    setDraft(d => {
      const set = new Set(d.assigned_trope_ids);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...d, assigned_trope_ids: Array.from(set) };
    });
  }

  function selectAllVisible() {
    setDraft(d => {
      const set = new Set(d.selected_keyword_ids);
      for (const k of filtered) {
        if (!isFullyCovered(k.text, metadataCovered)) set.add(k.id);
      }
      return { ...d, selected_keyword_ids: Array.from(set) };
    });
  }
  function clearAllVisible() {
    setDraft(d => {
      const set = new Set(d.selected_keyword_ids);
      for (const k of filtered) set.delete(k.id);
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

  const assignedTropes = useMemo(
    () => draft.assigned_trope_ids.map(id => tropeById.get(id)).filter((t): t is Trope => Boolean(t)),
    [draft.assigned_trope_ids, tropeById],
  );

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> Back to KDP books
      </button>

      {/* Book header */}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
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
              placeholder="Paranormal Romance, Werewolves & Shifters"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Metadata indexing alert */}
      <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4 text-sm text-indigo-900">
        <p className="mb-2">
          <strong>Metadata indexing:</strong> words from your Title, Subtitle, Series, and Amazon
          Categories are already covered by Amazon. Keywords made entirely of those words show as
          crossed out, and individual covered words are skipped in the 7-box optimizer.
        </p>
        {metadataCovered.size > 0 && (
          <p className="text-xs">
            <strong>Active metadata:</strong>{' '}
            <span className="text-indigo-700">{Array.from(metadataCovered).sort().join(', ')}</span>
          </p>
        )}
      </div>

      {/* Assigned tropes */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm">
            <span className="font-semibold text-slate-800">Assigned tropes</span>
            <span className="text-slate-500 ml-1">({assignedTropes.length})</span>
          </div>
          <button
            onClick={() => setShowAssignTropes(v => !v)}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            {showAssignTropes ? 'Done' : 'Edit tropes'}
          </button>
        </div>
        {assignedTropes.length === 0 && !showAssignTropes ? (
          <p className="text-sm text-slate-500">No tropes assigned. Edit tropes to choose which ones apply to this book.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {assignedTropes.map(t => (
              <span key={t.id} className="text-xs px-2 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                {t.name}
              </span>
            ))}
          </div>
        )}
        {showAssignTropes && (
          <div className="mt-4 max-h-64 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-1 border-t border-slate-100 pt-3">
            {tropes.map(t => (
              <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded text-sm">
                <input
                  type="checkbox"
                  checked={assignedTropeSet.has(t.id)}
                  onChange={() => toggleTrope(t.id)}
                />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Available keywords */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-800">
                Available keywords
                <span className="text-xs text-slate-500 ml-2">
                  {filtered.length} of {available.length} from {assignedTropes.length} tropes
                </span>
              </h3>
              <div className="flex gap-1 text-xs">
                <button onClick={selectAllVisible} className="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded">
                  Select all
                </button>
                <button onClick={clearAllVisible} className="px-2 py-1 text-slate-600 hover:bg-slate-50 rounded">
                  Clear
                </button>
              </div>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter keywords"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
            {assignedTropes.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Assign at least one trope to see its keywords here.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No keywords match.
              </div>
            ) : (
              filtered.map(k => {
                const selected = selectedKeywordSet.has(k.id);
                const covered = isFullyCovered(k.text, metadataCovered);
                return (
                  <label
                    key={k.id}
                    className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-slate-50 ${selected ? 'bg-indigo-50/40' : ''}`}
                  >
                    <input type="checkbox" checked={selected} onChange={() => toggleKeyword(k.id)} disabled={covered} />
                    <span className={`text-sm flex-1 truncate ${covered ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {k.text}
                    </span>
                    <KeywordMetrics keyword={k} />
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* 7-box optimizer */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 lg:sticky lg:top-4 self-start">
          <div>
            <h3 className="font-semibold text-slate-800">Optimization stats</h3>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <Stat label="Selected phrases" value={selectedRows.length} />
              <Stat label="Total search volume" value={totalSearchVolume.toLocaleString()} />
            </div>
            {packResult.unused.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">
                {packResult.unused.length} word{packResult.unused.length === 1 ? '' : 's'} couldn't fit
                in the 7 boxes — narrow your selection if you want them in.
              </p>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
              Amazon keyword boxes
            </h4>
            <div className="space-y-2">
              {packResult.boxes.map((content, i) => (
                <KeywordBox key={i} index={i + 1} content={content} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeywordBox({ index, content }: { index: number; content: string }) {
  const [copied, setCopied] = useState(false);
  const usage = content.length;
  const usageColor = usage === 50 ? 'text-emerald-600' : usage >= 40 ? 'text-slate-700' : 'text-slate-400';
  function copy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        <span>Box {index}</span>
        <span className={`font-mono ${usageColor}`}>{usage} / 50</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={content}
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-mono"
        />
        <button
          onClick={copy}
          title="Copy"
          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      {copied && <p className="text-[10px] text-emerald-600 mt-0.5">Copied!</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2">
      <div className="text-xl font-bold text-slate-800 leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

function KeywordMetrics({ keyword }: { keyword: Keyword }) {
  const sv = keyword.search_volume_color as ScoreColor | '';
  const cs = keyword.competitive_score_color as ScoreColor | '';
  return (
    <div className="flex items-center gap-1.5 text-xs shrink-0">
      {sv && (
        <span className={`px-1.5 py-0.5 rounded font-mono ${VOL_CHIP[sv]}`} title="Estimated searches">
          {keyword.search_volume.toLocaleString()}
        </span>
      )}
      {cs && (
        <span className={`px-1.5 py-0.5 rounded font-mono ${VOL_CHIP[cs]}`} title="Competition score">
          {keyword.competitive_score}
        </span>
      )}
    </div>
  );
}

// Re-export so the unused import warning is silenced if a future
// refactor drops keywordWords here.
export { keywordWords };
