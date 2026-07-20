import { useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckSquare, Copy, Info, Save, Search, Square, TrendingUp } from 'lucide-react';
import type { Book } from '../../catalog/types';
import { updateKdpBook } from '../api';
import type { KdpBook, Keyword, ScoreColor, Trope } from '../types';
import {
  analyzeKeywordCoverage, cleanKeywordText, getMetadataWords, isStopWord, optimizeKeywords,
} from '../utils';
import CatalogBookPicker from '../../../components/CatalogBookPicker';
import PenNameChip from '../../../components/PenNameChip';
import { usePenNames } from '../../../contexts/PenNameContext';

interface Props {
  book: KdpBook;
  tropes: Trope[];
  keywords: Keyword[];
  catalogBooks: Book[];
  onBack: () => void;
  onSaved: (updated: KdpBook) => void;
}

const COLOR_BG: Record<ScoreColor, string> = {
  Green: 'bg-emerald-100 text-emerald-800',
  Yellow: 'bg-amber-100 text-amber-800',
  Red: 'bg-rose-100 text-rose-800',
  Gray: 'bg-surface-sunken text-content-secondary',
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtCurrency = (n: number) => `$${n.toFixed(2)}`;

export default function BookOptimizer({ book, tropes, keywords, catalogBooks, onBack, onSaved }: Props) {
  const [draft, setDraft] = useState<KdpBook>(book);
  const { penNames } = usePenNames();

  // When linked to a Catalog book, treat that as the source of truth
  // for display + metadata indexing. The KDP row's own title/subtitle/
  // series stay as a fallback for unlinked books and as the value the
  // BookOptimizer saves to (so existing data still round-trips even if
  // the user later unlinks).
  const linkedCatalog = draft.book_id
    ? catalogBooks.find(b => b.id === draft.book_id) ?? null
    : null;
  const effective = {
    title: linkedCatalog?.title ?? draft.title,
    subtitle: linkedCatalog?.subtitle ?? draft.subtitle,
    series: linkedCatalog?.series ?? draft.series,
  };
  const linkedPenName = linkedCatalog?.pen_name_id
    ? penNames.find(p => p.id === linkedCatalog.pen_name_id) ?? null
    : null;
  const [filterText, setFilterText] = useState('');
  const [showAssignTropes, setShowAssignTropes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(draft.selected_keyword_ids), [draft.selected_keyword_ids]);
  const assignedSet = useMemo(() => new Set(draft.assigned_trope_ids), [draft.assigned_trope_ids]);
  const tropeById = useMemo(() => new Map(tropes.map(t => [t.id, t])), [tropes]);

  const assignedTropes = useMemo(
    () => draft.assigned_trope_ids.map(id => tropeById.get(id)).filter((t): t is Trope => Boolean(t)),
    [draft.assigned_trope_ids, tropeById],
  );

  // 1. Raw pool: every keyword whose trope is assigned to this book.
  // 2. Dedup by lowercased text — when collisions, prefer the
  //    currently-selected one, then higher search volume.
  const uniquePool = useMemo(() => {
    const map = new Map<string, Keyword>();
    for (const k of keywords) {
      if (!assignedSet.has(k.trope_id)) continue;
      const norm = k.text.toLowerCase().trim();
      const existing = map.get(norm);
      if (!existing) {
        map.set(norm, k);
        continue;
      }
      const kSel = selectedSet.has(k.id);
      const eSel = selectedSet.has(existing.id);
      if (kSel && !eSel) map.set(norm, k);
      else if (kSel === eSel && k.search_volume > existing.search_volume) map.set(norm, k);
    }
    return Array.from(map.values());
  }, [keywords, assignedSet, selectedSet]);

  // Metadata indexing uses the effective (Catalog-preferred) title so
  // crossed-out keywords reflect what's actually on the live listing,
  // not stale KDP-row values.
  const metadataWords = useMemo(
    () => getMetadataWords({ ...draft, ...effective }),
    [draft, effective.title, effective.subtitle, effective.series],
  );

  // Effective coverage = metadata + words from already-selected
  // keywords. Used for visual strike-through; the optimizer itself
  // only excludes metadata, since the selected words ARE the input.
  const effectiveCovered = useMemo(() => {
    const out = new Set(metadataWords);
    for (const k of keywords) {
      if (!selectedSet.has(k.id)) continue;
      for (const w of cleanKeywordText(k.text)) out.add(w);
    }
    return out;
  }, [metadataWords, keywords, selectedSet]);

  const filteredPool = useMemo(() => {
    const q = filterText.toLowerCase();
    return uniquePool
      .filter(k => k.text.toLowerCase().includes(q))
      .sort((a, b) => b.search_volume - a.search_volume);
  }, [uniquePool, filterText]);

  const selectedKeywords = useMemo(
    () => keywords.filter(k => selectedSet.has(k.id)),
    [keywords, selectedSet],
  );
  const totalVolume = selectedKeywords.reduce((sum, k) => sum + (k.search_volume || 0), 0);

  const optimizedBoxes = useMemo(
    () => optimizeKeywords(selectedKeywords.map(k => k.text), metadataWords),
    [selectedKeywords, metadataWords],
  );

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-content-secondary hover:text-content mb-2">
            <ArrowLeft className="w-4 h-4" /> Back to KDP books
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-content">{effective.title || '(untitled)'}</h2>
            {linkedPenName && <PenNameChip name={linkedPenName.name} color={linkedPenName.color} />}
          </div>
          <div className="text-sm text-content-secondary flex flex-wrap items-center gap-2">
            {effective.subtitle && <span>{effective.subtitle}</span>}
            {effective.subtitle && effective.series && <span>•</span>}
            {effective.series && <span className="text-content-muted">{effective.series}</span>}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-edge-strong rounded-control shadow-sm shrink-0"
        >
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-control bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* Book metadata */}
      <div className="bg-surface rounded-card border border-edge p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <label className="block text-xs font-medium text-content mb-1">Linked Catalog book</label>
          <CatalogBookPicker
            value={draft.book_id ?? null}
            onChange={(id, book) => setDraft(d => ({
              ...d,
              book_id: id,
              // Mirror the linked book's metadata into the KDP row on
              // link so unlinking later doesn't leave us with stale
              // empty title/series. The UI continues to display from
              // `effective` (Catalog-preferred) while linked.
              title: book.title || d.title,
              subtitle: book.subtitle ?? d.subtitle,
              series: book.series ?? d.series,
            }))}
            filterByPenName={false}
            placeholder="Not linked"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-content mb-1">Amazon categories</label>
          <input
            value={draft.amazon_categories}
            onChange={e => setDraft(d => ({ ...d, amazon_categories: e.target.value }))}
            placeholder="Paranormal Romance, Werewolves & Shifters"
            className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Metadata indexing banner */}
      <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-control text-sm text-indigo-800 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <span className="font-semibold">Metadata indexing:</span> words from your Title, Subtitle,
          Series, Amazon Categories, and{' '}
          <span className="font-bold underline decoration-indigo-400">Selected Keywords</span> are
          considered "covered". Keywords below that are <s>crossed out</s> are already present in these
          sources.
          {metadataWords.size > 0 && (
            <div className="mt-1 text-xs text-indigo-600 opacity-80">
              <strong>Active metadata:</strong> {Array.from(metadataWords).sort().join(', ')}
            </div>
          )}
        </div>
      </div>

      {/* Assigned tropes */}
      <div className="bg-surface rounded-card border border-edge p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm">
            <span className="font-semibold text-content">Assigned tropes</span>
            <span className="text-content-secondary ml-1">({assignedTropes.length})</span>
          </div>
          <button onClick={() => setShowAssignTropes(v => !v)} className="text-sm text-indigo-600 hover:text-indigo-800">
            {showAssignTropes ? 'Done' : 'Edit tropes'}
          </button>
        </div>
        {assignedTropes.length === 0 && !showAssignTropes ? (
          <p className="text-sm text-content-secondary">No tropes assigned. Edit tropes to choose which ones apply to this book.</p>
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
          <div className="mt-4 max-h-64 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-1 border-t border-edge-soft pt-3">
            {tropes.map(t => (
              <label key={t.id} className="flex items-center gap-2 px-2 py-1 hover:bg-surface-hover rounded text-sm">
                <input type="checkbox" checked={assignedSet.has(t.id)} onChange={() => toggleTrope(t.id)} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Available Keywords */}
        <div className="lg:col-span-2 bg-surface rounded-card border border-edge overflow-hidden">
          <div className="p-4 border-b border-edge-soft bg-surface-hover">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="font-semibold text-content">Available keywords</h3>
              <span className="text-xs text-content-secondary">
                Found: {filteredPool.length} (Deduped) of {uniquePool.length}
              </span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                placeholder="Filter keywords"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-control border border-edge-strong focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            {assignedTropes.length > 0 && (
              <p className="mt-2 text-xs text-content-secondary">
                Sources: {assignedTropes.map(t => t.name).join(', ')}
              </p>
            )}
          </div>

          {assignedTropes.length === 0 ? (
            <div className="p-8 text-center text-sm text-content-secondary">
              Assign at least one trope to see its keywords here.
            </div>
          ) : (
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full text-sm text-left">
                <thead className="bg-surface-hover text-content-secondary font-medium sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 whitespace-nowrap">Keyword</th>
                    <th className="px-3 py-2 whitespace-nowrap">Est. Searches</th>
                    <th className="px-3 py-2 whitespace-nowrap">Comp Score</th>
                    <th className="px-3 py-2 whitespace-nowrap">Competitors</th>
                    <th className="px-3 py-2 whitespace-nowrap">Avg Pages</th>
                    <th className="px-3 py-2 whitespace-nowrap">Avg Price</th>
                    <th className="px-3 py-2 whitespace-nowrap">Avg Monthly</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge-soft">
                  {filteredPool.map(kw => {
                    const isSelected = selectedSet.has(kw.id);
                    const coverage = analyzeKeywordCoverage(kw.text, effectiveCovered);
                    return (
                      <tr
                        key={kw.id}
                        onClick={() => toggleKeyword(kw.id)}
                        className={`cursor-pointer transition ${isSelected ? 'bg-indigo-50' : 'hover:bg-surface-hover'}`}
                      >
                        <td className="px-3 py-2">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <Square className="w-4 h-4 text-content-faint" />
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          {kw.text.split(' ').map((word, idx) => {
                            const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
                            const isCovered =
                              effectiveCovered.has(clean) || isStopWord(clean) || clean.length === 0;
                            return (
                              <span
                                key={idx}
                                className={
                                  isCovered
                                    ? 'text-content-muted line-through decoration-slate-400 decoration-1 mr-1'
                                    : 'text-content mr-1'
                                }
                              >
                                {word}
                              </span>
                            );
                          })}
                          {coverage.isFullyCovered && !isSelected && (
                            <span className="ml-2 text-[10px] bg-surface-sunken text-content-secondary px-1.5 py-0.5 rounded border border-edge">
                              Covered
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2"><Chip text={fmtNum(kw.search_volume)} color={kw.search_volume_color as ScoreColor} /></td>
                        <td className="px-3 py-2"><Chip text={String(kw.competitive_score)} color={kw.competitive_score_color as ScoreColor} /></td>
                        <td className="px-3 py-2 text-content-secondary">{fmtNum(kw.competitors)}</td>
                        <td className="px-3 py-2 text-content-secondary">{fmtNum(kw.avg_pages)}</td>
                        <td className="px-3 py-2 text-content-secondary">{fmtCurrency(kw.avg_price)}</td>
                        <td className="px-3 py-2 text-content-secondary">{fmtCurrency(kw.avg_monthly_earnings)}</td>
                      </tr>
                    );
                  })}
                  {filteredPool.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-content-muted">
                        No keywords found. Check your filters or assign more tropes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RIGHT: Optimization */}
        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="bg-indigo-900 text-white p-5 rounded-card shadow-sm">
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Optimization stats
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-indigo-200 text-xs">Selected phrases</span>
                <span className="text-2xl font-bold">{selectedKeywords.length}</span>
              </div>
              <div>
                <span className="block text-indigo-200 text-xs">Total search volume</span>
                <span className="text-2xl font-bold">{fmtNum(totalVolume)}</span>
              </div>
            </div>
            <p className="mt-4 text-xs text-indigo-200 bg-indigo-800/50 p-3 rounded">
              Algorithm excludes words already in your Title, Subtitle, Series, and Amazon
              Categories — Tropes are organization buckets and aren't indexed by Amazon.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-content mb-3">
              Amazon keyword boxes ({Math.min(optimizedBoxes.length, 7)}/7)
            </h3>
            <div className="space-y-3">
              {Array.from({ length: 7 }).map((_, idx) => (
                <KeywordBox key={idx} index={idx + 1} content={optimizedBoxes[idx] || ''} />
              ))}
            </div>
            {optimizedBoxes.length > 7 && (
              <div className="mt-3 p-3 bg-rose-50 text-rose-700 rounded-control text-sm flex items-start gap-2 border border-rose-200">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                You have enough unique words to fill {optimizedBoxes.length} boxes. The extras are hidden.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ text, color }: { text: string; color: ScoreColor | '' }) {
  const klass = color ? COLOR_BG[color] : COLOR_BG.Gray;
  return <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-xs ${klass}`}>{text}</span>;
}

function KeywordBox({ index, content }: { index: number; content: string }) {
  const [copied, setCopied] = useState(false);
  const len = content.length;
  const isOver = len > 50;
  const isEmpty = len === 0;
  function copy() {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="flex justify-between text-xs text-content-secondary mb-1">
        <span className="font-medium">Box {index}</span>
        <span className={isOver ? 'text-rose-500 font-bold' : len === 50 ? 'text-emerald-600' : ''}>
          {len} / 50
        </span>
      </div>
      <div className="relative">
        <input
          readOnly
          value={content}
          placeholder="Empty"
          className={`w-full p-3 pr-10 rounded-control font-mono text-sm text-content border ${
            isEmpty ? 'bg-surface-hover border-edge' : 'bg-surface border-indigo-200'
          } ${isOver ? 'border-rose-500' : ''}`}
        />
        {!isEmpty && (
          <button
            onClick={copy}
            title="Copy"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-content-faint hover:text-indigo-600"
          >
            <Copy className="w-4 h-4" />
          </button>
        )}
      </div>
      {copied && <p className="text-[10px] text-emerald-600 mt-0.5">Copied!</p>}
    </div>
  );
}
