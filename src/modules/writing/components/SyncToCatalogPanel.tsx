import { useEffect, useState } from 'react';
import { Library, X, Sparkles, Loader2, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { getManuscriptPlainText } from '../api';
import { getBook, updateBook } from '../../catalog/api';
import { getAiSettings, aiSettingsToRequest, writingComplete } from '../lib/ai';
import AiSettingsPanel from './AiSettingsPanel';
import type { Manuscript } from '../types';
import type { Book } from '../../catalog/types';

const CONTEXT_WORD_BUDGET = 30_000;
const SYNC_DEFAULT_MAX_TOKENS = 1500;

const SYSTEM = [
  'You are an editorial assistant analyzing a fiction manuscript for a catalog entry.',
  'Read the excerpt and extract: recurring THEMES, genre TROPES, and a punchy back-cover-style BLURB (2-4 sentences, no spoilers for the ending).',
  'Return ONLY a JSON object of the exact form: {"themes": string[], "tropes": string[], "suggestedBlurb": string}. No commentary, no code fences.',
].join('\n');

interface CatalogAnalysis {
  themes: string[];
  tropes: string[];
  suggestedBlurb: string;
}

function coerceAnalysis(raw: string): CatalogAnalysis {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    return {
      themes: Array.isArray(parsed.themes) ? parsed.themes.filter((t): t is string => typeof t === 'string') : [],
      tropes: Array.isArray(parsed.tropes) ? parsed.tropes.filter((t): t is string => typeof t === 'string') : [],
      suggestedBlurb: typeof parsed.suggestedBlurb === 'string' ? parsed.suggestedBlurb : '',
    };
  } catch {
    return { themes: [], tropes: [], suggestedBlurb: '' };
  }
}

// "Analyze for Catalog" — the concrete payoff of manuscript-in-one-place:
// extracts themes/tropes/blurb from the manuscript text and lets the author
// accept each into the linked Catalog book. Only `blurb` and `tropes` are
// Catalog book columns (directive §6 item 4); themes have no matching field
// so they're shown for reference only, not written anywhere. Tropes are
// merged with whatever's already on the book, never silently overwritten —
// same for blurb, which requires an explicit "Use this blurb" click.
export default function SyncToCatalogPanel({
  manuscript,
  onClose,
  onApplied,
}: {
  manuscript: Manuscript;
  onClose: () => void;
  onApplied: (book: Book) => void;
}) {
  const { user } = useAuth();
  const [book, setBook] = useState<Book | null>(null);
  const [loadingBook, setLoadingBook] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CatalogAnalysis | null>(null);
  const [selectedTropes, setSelectedTropes] = useState<Set<string>>(new Set());
  const [blurbDraft, setBlurbDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingTropes, setSavingTropes] = useState(false);
  const [savingBlurb, setSavingBlurb] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!manuscript.book_id) { setLoadingBook(false); return; }
    let cancelled = false;
    getBook(manuscript.book_id)
      .then(b => { if (!cancelled) setBook(b); })
      .catch(err => { if (!cancelled) setError((err as Error)?.message ?? String(err)); })
      .finally(() => { if (!cancelled) setLoadingBook(false); });
    return () => { cancelled = true; };
  }, [manuscript.book_id]);

  async function analyze() {
    if (!user || !manuscript.book_id) return;
    setAnalyzing(true);
    setError(null);
    try {
      const text = await getManuscriptPlainText(user.id, manuscript.id);
      const words = text.split(/\s+/).filter(Boolean);
      const wasTruncated = words.length > CONTEXT_WORD_BUDGET;
      setTruncated(wasTruncated);
      const bounded = wasTruncated ? words.slice(0, CONTEXT_WORD_BUDGET).join(' ') : text;
      const settings = getAiSettings();
      const raw = await writingComplete({
        ...aiSettingsToRequest(settings, SYNC_DEFAULT_MAX_TOKENS),
        system: SYSTEM,
        prompt: `MANUSCRIPT EXCERPT:\n\n${bounded}`,
      });
      const parsed = coerceAnalysis(raw);
      setAnalysis(parsed);
      setBlurbDraft(parsed.suggestedBlurb);
      setSelectedTropes(new Set());
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleTrope(t: string) {
    setSelectedTropes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  async function applyTropes() {
    if (!book || selectedTropes.size === 0) return;
    setSavingTropes(true);
    setError(null);
    try {
      const merged = Array.from(new Set([...(book.tropes ?? []), ...selectedTropes]));
      const updated = await updateBook(book.id, { tropes: merged });
      setBook(updated);
      onApplied(updated);
      setSelectedTropes(new Set());
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setSavingTropes(false);
    }
  }

  async function applyBlurb() {
    if (!book || !blurbDraft.trim()) return;
    setSavingBlurb(true);
    setError(null);
    try {
      const updated = await updateBook(book.id, { blurb: blurbDraft.trim() });
      setBook(updated);
      onApplied(updated);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setSavingBlurb(false);
    }
  }

  const existingTropes = new Set(book?.tropes ?? []);
  const newTropes = (analysis?.tropes ?? []).filter(t => !existingTropes.has(t));

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Library className="w-4 h-4 text-lime-500" /> Sync to Catalog
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadingBook ? (
            <p className="text-sm text-slate-400">Loading linked book…</p>
          ) : !book ? (
            <p className="text-sm text-slate-500">Link this manuscript to a Catalog book first — from the manuscript header — to use this.</p>
          ) : (
            <>
              <p className="text-sm text-slate-500">
                Analyzes the manuscript text and suggests themes, tropes, and a blurb for <span className="font-medium text-slate-700">{book.title}</span>.
                Nothing is saved until you accept it below.
              </p>

              {!analysis && (
                <button
                  onClick={analyze}
                  disabled={analyzing}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-lg disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {analyzing ? 'Analyzing…' : 'Analyze for Catalog'}
                </button>
              )}

              {truncated && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Analysis used the manuscript's first {CONTEXT_WORD_BUDGET.toLocaleString()} words.
                </p>
              )}

              {analysis && (
                <div className="space-y-5">
                  {analysis.themes.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1.5">Themes (for reference — no Catalog field to save into)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.themes.map(t => (
                          <span key={t} className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-slate-500">Tropes</p>
                      <button
                        onClick={applyTropes}
                        disabled={selectedTropes.size === 0 || savingTropes}
                        className="inline-flex items-center gap-1 text-xs font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-md px-2 py-1 disabled:opacity-50"
                      >
                        {savingTropes ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Add {selectedTropes.size || ''} to book
                      </button>
                    </div>
                    {newTropes.length === 0 ? (
                      <p className="text-xs text-slate-400">No new tropes suggested{book.tropes?.length ? ' — the book already has these covered.' : '.'}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {newTropes.map(t => (
                          <label key={t} className={`text-xs px-2 py-1 rounded-full border cursor-pointer ${
                            selectedTropes.has(t) ? 'bg-lime-100 border-lime-300 text-lime-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}>
                            <input type="checkbox" className="hidden" checked={selectedTropes.has(t)} onChange={() => toggleTrope(t)} />
                            {t}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-slate-500">Blurb</p>
                      <button
                        onClick={applyBlurb}
                        disabled={!blurbDraft.trim() || savingBlurb}
                        className="inline-flex items-center gap-1 text-xs font-medium text-white bg-lime-600 hover:bg-lime-700 rounded-md px-2 py-1 disabled:opacity-50"
                      >
                        {savingBlurb ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Use this blurb
                      </button>
                    </div>
                    {book.blurb && (
                      <p className="text-xs text-slate-400 mb-1.5 italic">Current: {book.blurb.slice(0, 140)}{book.blurb.length > 140 ? '…' : ''}</p>
                    )}
                    <textarea
                      value={blurbDraft}
                      onChange={e => setBlurbDraft(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>

                  <button onClick={analyze} disabled={analyzing} className="text-xs text-slate-500 hover:underline disabled:opacity-50">
                    {analyzing ? 'Re-analyzing…' : 'Re-analyze'}
                  </button>
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        {book && (
          <div className="px-5 py-3 border-t border-slate-100 shrink-0 flex justify-end">
            <AiSettingsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
