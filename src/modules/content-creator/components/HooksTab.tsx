import { useEffect, useRef, useState } from 'react';
import { Anchor, Loader2, Play, Square, Star, Trash2, ChevronDown, ChevronRight, ShieldAlert, Plus, Quote, Sparkles, Check } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../../catalog/types';
import type { Manuscript } from '../../writing/types';
import { listChapters } from '../../writing/api';
import {
  listHooks, insertHooks, updateHook, deleteHook, deleteCandidateHooks,
  getRunningScan, createScan, updateScan,
  listPlaybookEntries, listRules, listDefaultBannedWords, listBannedWordOptouts,
} from '../api';
import type { ContentHook, HookCandidate, WrittenHook, HookStatus, HookTestResult } from '../types';
import { runJsonTask, runTask, getTaskModel } from '../lib/ai';
import {
  buildPreamble, buildExtractPrompt, buildRankPrompt, buildVerifyPrompt, buildSynonymPrompt,
  buildVariationsPrompt, buildPremisePrompt, parseJsonResponse, type HookVerdict, type HookVariation,
} from '../lib/prompts';
import ScanModelPickers from './ScanModelPickers';
import { findSceneForQuote, type FoundScene } from '../lib/sceneLookup';
import {
  buildActiveBannedWords, scanForBannedWords, maskWord, replaceBannedWord,
  type ActiveBannedWord, type BannedMatch,
} from '../lib/bannedWords';

// Hooks tab: run a manual, resumable, chapter-by-chapter manuscript scan
// (small request per chapter — never one giant serverless call), then manage
// the saved hook list: approve, edit, favorite, archive.

const RANK_TARGET = 20;

interface ScanProgress {
  total: number;
  done: number;
  phase: 'chapters' | 'ranking' | 'verifying';
}

export default function HooksTab({ book, manuscript }: { book: Book; manuscript: Manuscript | null }) {
  const { user } = useAuth();
  const [hooks, setHooks] = useState<ContentHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [resumable, setResumable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HookStatus | 'all'>('all');
  const [bannedActive, setBannedActive] = useState<ActiveBannedWord[]>([]);
  const [playbookEmpty, setPlaybookEmpty] = useState(false);
  const [workshopSeed, setWorkshopSeed] = useState<{ text: string } | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listHooks(user.id, book.id),
      manuscript ? getRunningScan(user.id, manuscript.id) : Promise.resolve(null),
      listDefaultBannedWords(),
      listBannedWordOptouts(user.id),
      listRules(user.id),
      listPlaybookEntries(user.id),
    ])
      .then(([h, scan, defaults, optouts, rules, entries]) => {
        if (cancelled) return;
        setHooks(h);
        setResumable(!!scan);
        setBannedActive(buildActiveBannedWords(defaults, optouts, rules));
        setPlaybookEmpty(entries.filter(e => e.active).length === 0);
      })
      .catch(err => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, book.id, manuscript]);

  async function runScan() {
    if (!user || !manuscript) return;
    setScanning(true);
    setError(null);
    cancelRef.current = false;
    try {
      // Gather everything the prompts need once, up front.
      const [chapters, entries, rules, defaults, optouts] = await Promise.all([
        listChapters(manuscript.id),
        listPlaybookEntries(user.id),
        listRules(user.id),
        listDefaultBannedWords(),
        listBannedWordOptouts(user.id),
      ]);
      if (!chapters.length) throw new Error('This manuscript has no chapters to scan.');
      const activeEntries = entries.filter(e => e.active && (!e.pen_name_id || e.pen_name_id === book.pen_name_id));
      const activeRules = rules.filter(r => r.active);
      const banned = buildActiveBannedWords(defaults, optouts, rules);
      const system = buildPreamble({
        book, entries: activeEntries, rules: activeRules, bannedWords: banned,
        workedHooks: hooks.filter(h => h.test_result === 'worked').map(h => h.hook_text),
        failedHooks: hooks.filter(h => h.test_result === 'failed').map(h => h.hook_text),
      });

      // Resume the running scan if there is one; otherwise start fresh.
      let scan = await getRunningScan(user.id, manuscript.id);
      if (!scan) {
        const model = await getTaskModel(user.id, 'extract');
        scan = await createScan(user.id, manuscript.id, `${model.provider}/${model.model_id}`);
      }
      const scanned = new Set(scan.scanned_chapter_ids);
      let candidates: HookCandidate[] = [...(scan.candidates ?? [])];
      const pending = chapters.filter(c => !scanned.has(c.id));
      setProgress({ total: chapters.length, done: chapters.length - pending.length, phase: 'chapters' });

      for (const chapter of pending) {
        if (cancelRef.current) {
          await updateScan(scan.id, { status: 'cancelled', scanned_chapter_ids: [...scanned], candidates });
          setResumable(true);
          return;
        }
        const text = htmlToText(chapter.content_html);
        if (text.trim().length > 200) {
          const out = await runJsonTask<{ candidates: HookCandidate[] }>({
            userId: user.id,
            task: 'extract',
            system,
            prompt: buildExtractPrompt(chapter.title, chapter.idx, text.slice(0, 60000)),
            maxTokens: 2048,
          });
          candidates = candidates.concat(
            (out.candidates ?? []).filter(c => c.moment?.trim() && c.scene_excerpt?.trim()).map(c => ({
              moment: c.moment.trim(),
              scene_excerpt: c.scene_excerpt,
              tags: Array.isArray(c.tags) ? c.tags : [],
            })),
          );
        }
        scanned.add(chapter.id);
        // Persist after every chapter — this is the resume point.
        await updateScan(scan.id, { scanned_chapter_ids: [...scanned], candidates });
        setProgress(p => p ? { ...p, done: p.done + 1 } : p);
      }

      if (!candidates.length) {
        await updateScan(scan.id, { status: 'done' });
        setResumable(false);
        throw new Error('The scan finished but found no hook candidates. Check that the manuscript has real chapter content.');
      }

      setProgress(p => p ? { ...p, phase: 'ranking' } : p);
      const ranked = await runJsonTask<{ hooks: WrittenHook[] }>({
        userId: user.id,
        task: 'rank',
        system,
        prompt: buildRankPrompt(candidates, RANK_TARGET),
        maxTokens: 4096,
      });
      const written = (ranked.hooks ?? []).filter(h => h.hook_text?.trim()).slice(0, RANK_TARGET);
      if (!written.length) throw new Error('The writing pass returned no hooks — try re-running the scan.');

      // Verify pass: fact-check every hook against its own excerpt and apply
      // the interest test. Bad hooks get one rewrite or are dropped entirely.
      setProgress({ total: written.length, done: 0, phase: 'verifying' });
      const survivors: WrittenHook[] = [];
      for (const h of written) {
        if (cancelRef.current) break;
        try {
          const verdict = await runJsonTask<HookVerdict>({
            userId: user.id,
            task: 'rank',
            system,
            prompt: buildVerifyPrompt(h.hook_text, h.scene_excerpt ?? ''),
            maxTokens: 1024,
          });
          if (verdict.is_hook && (verdict.accurate || verdict.fixed_hook_text)) {
            survivors.push({
              ...h,
              hook_text: (verdict.accurate ? h.hook_text : verdict.fixed_hook_text ?? h.hook_text).trim(),
            });
          }
        } catch {
          // Verification hiccup shouldn't kill the scan — keep the hook as-is.
          survivors.push(h);
        }
        setProgress(p => p ? { ...p, done: p.done + 1 } : p);
      }
      if (!survivors.length) throw new Error('Every hook failed verification — the scan found no material strong enough. Try adding playbook patterns first.');

      const added = await insertHooks(user.id, survivors.map(h => ({
        book_id: book.id,
        manuscript_id: manuscript.id,
        hook_text: h.hook_text,
        scene_excerpt: h.scene_excerpt ?? '',
        rationale: h.rationale ?? '',
        tags: Array.isArray(h.tags) ? h.tags : [],
        source: 'scan' as const,
      })));
      await updateScan(scan.id, { status: 'done' });
      setHooks(prev => [...added, ...prev]);
      setResumable(false);
    } catch (err) {
      setError((err as Error).message);
      setResumable(true);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-content-muted" /></div>;
  if (!user) return null;

  const visible = statusFilter === 'all' ? hooks : hooks.filter(h => h.status === statusFilter);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="bg-surface rounded-card border border-edge p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-content flex items-center gap-2">
              <Anchor className="w-4 h-4 text-content-muted" /> Manuscript scan
            </h3>
            <p className="text-xs text-content-secondary mt-0.5">
              {manuscript
                ? `Scans "${manuscript.title}" chapter by chapter and builds your hook list. You start it; nothing runs on its own.`
                : 'Link a manuscript to this book in the Writing module to enable scanning.'}
            </p>
          </div>
          {!scanning ? (
            <button
              onClick={runScan}
              disabled={!manuscript}
              className="px-4 py-2 rounded-control bg-brand-600 text-brand-fg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> {resumable ? 'Resume scan' : 'Scan manuscript'}
            </button>
          ) : (
            <button
              onClick={() => { cancelRef.current = true; }}
              className="px-4 py-2 rounded-control border border-edge-strong text-content-secondary text-sm font-medium hover:bg-surface-hover flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
        {progress && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-content-secondary mb-1">
              <span>
                {progress.phase === 'chapters' ? `Reading chapter ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                  : progress.phase === 'ranking' ? 'Writing hooks from the strongest moments…'
                  : `Fact-checking hook ${Math.min(progress.done + 1, progress.total)} of ${progress.total} against its scene…`}
              </span>
              {progress.phase !== 'ranking' && <span>{Math.round((progress.done / progress.total) * 100)}%</span>}
            </div>
            <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
              <div
                className={`h-full rounded-full bg-brand-500 transition-all ${progress.phase === 'ranking' ? 'animate-pulse w-full' : ''}`}
                style={progress.phase !== 'ranking' ? { width: `${(progress.done / progress.total) * 100}%` } : undefined}
              />
            </div>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
        {playbookEmpty && !scanning && (
          <p className="text-xs text-content-muted mt-3">
            Scans use the built-in hook strategy library automatically. Add your own patterns in the Playbook tab to extend it.
          </p>
        )}
        <div className="mt-3 border-t border-edge-soft pt-3">
          <ScanModelPickers disabled={scanning} />
        </div>
      </div>

      <QuoteWorkshop
        userId={user.id}
        book={book}
        manuscriptId={manuscript?.id ?? null}
        bannedActive={bannedActive}
        onSaved={h => setHooks(prev => [h, ...prev])}
        workedHooks={hooks.filter(h => h.test_result === 'worked').map(h => h.hook_text)}
        failedHooks={hooks.filter(h => h.test_result === 'failed').map(h => h.hook_text)}
        seed={workshopSeed}
      />

      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-surface-sunken rounded-control p-1">
          {(['all', 'candidate', 'approved', 'archived'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-control text-xs font-medium capitalize ${statusFilter === s ? 'bg-surface text-content shadow-sm' : 'text-content-secondary hover:text-content'}`}
            >
              {s === 'all' ? `All (${hooks.length})` : `${s} (${hooks.filter(h => h.status === s).length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {hooks.some(h => h.status === 'candidate') && (
            <button
              onClick={async () => {
                if (!confirm('Delete every unapproved candidate for this book? Approved and archived hooks are kept.')) return;
                await deleteCandidateHooks(user.id, book.id);
                setHooks(prev => prev.filter(h => h.status !== 'candidate'));
              }}
              className="text-xs text-content-muted hover:text-rose-600"
            >
              Clear candidates
            </button>
          )}
          <ImportMomentsButton userId={user.id} bookId={book.id} manuscriptId={manuscript?.id ?? null} onAdded={added => setHooks(prev => [...added, ...prev])} />
          <AddHookButton userId={user.id} bookId={book.id} manuscriptId={manuscript?.id ?? null} onAdded={h => setHooks(prev => [h, ...prev])} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-surface rounded-card border border-dashed border-edge-strong p-10 text-center">
          <p className="text-content-secondary text-sm">
            {hooks.length === 0 ? 'No hooks yet — run a scan or add one by hand.' : 'Nothing with this status.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(h => (
            <HookCard
              key={h.id}
              hook={h}
              userId={user.id}
              bannedActive={bannedActive}
              onChanged={next => setHooks(prev => prev.map(x => x.id === next.id ? next : x))}
              onDeleted={() => setHooks(prev => prev.filter(x => x.id !== h.id))}
              onWorkshop={text => { setWorkshopSeed({ text }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const MAX_VARIATIONS = 8;

// Paste one quote you already love → one hook per fitting strategy from the
// library, labeled, side by side. The answer to "the scan converges on one
// shape": here variety is the assignment, not a suggestion.
function QuoteWorkshop({ userId, book, manuscriptId, bannedActive, onSaved, workedHooks, failedHooks, seed }: {
  userId: string;
  book: Book;
  manuscriptId: string | null;
  bannedActive: ActiveBannedWord[];
  onSaved: (h: ContentHook) => void;
  workedHooks: string[];
  failedHooks: string[];
  seed: { text: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variations, setVariations] = useState<HookVariation[]>([]);
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());
  const [scene, setScene] = useState<FoundScene | null>(null);
  const [sceneStatus, setSceneStatus] = useState<'idle' | 'found' | 'notfound'>('idle');
  // Premise-mode runs write from book facts only; saved variations then
  // carry no scene, and the quote box is ignored.
  const [premiseRun, setPremiseRun] = useState(false);

  // A hook card's "Workshop" button seeds the quote box.
  useEffect(() => {
    if (seed?.text) { setQuote(seed.text); setOpen(true); }
  }, [seed]);

  async function buildSystem(): Promise<string> {
    const [entries, rules] = await Promise.all([listPlaybookEntries(userId), listRules(userId)]);
    const activeEntries = entries.filter(e => e.active && (!e.pen_name_id || e.pen_name_id === book.pen_name_id));
    return buildPreamble({
      book, entries: activeEntries, rules: rules.filter(r => r.active), bannedWords: bannedActive,
      workedHooks, failedHooks,
    });
  }

  async function runVariations(prompt: string, premise: boolean) {
    const system = await buildSystem();
    const out = await runJsonTask<{ variations: HookVariation[] }>({
      userId, task: 'rank', system, prompt, maxTokens: 2048,
    });
    const clean = (out.variations ?? []).filter(v => v.hook_text?.trim()).slice(0, MAX_VARIATIONS);
    if (!clean.length) throw new Error(premise ? 'No premise hooks came back — check the book has tropes/blurb in Catalog.' : 'No variations came back — try a longer or more charged excerpt.');
    setVariations(clean);
    setPremiseRun(premise);
  }

  async function generate() {
    if (quote.trim().length < 20) { setError('Paste a little more of the moment — a line or two at least.'); return; }
    setBusy(true); setError(null); setVariations([]); setSavedIdx(new Set());
    try {
      // Locate the pasted quote in the linked manuscript (plain text
      // search, no AI cost) so the writer gets the whole scene, not just
      // the one line — and so the saved hook carries slideshow material.
      let found: FoundScene | null = null;
      if (manuscriptId) {
        try { found = await findSceneForQuote(manuscriptId, quote); } catch { /* search is best-effort */ }
      }
      setScene(found);
      setSceneStatus(found ? 'found' : 'notfound');
      await runVariations(buildVariationsPrompt(quote, found?.excerpt ?? '', notes, MAX_VARIATIONS), false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Premise hooks: book facts only, no quote needed (the Lightlark shape).
  async function generatePremise() {
    setBusy(true); setError(null); setVariations([]); setSavedIdx(new Set());
    setScene(null); setSceneStatus('idle');
    try {
      await runVariations(buildPremisePrompt(MAX_VARIATIONS), true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveVariation(v: HookVariation, idx: number) {
    const [h] = await insertHooks(userId, [{
      book_id: book.id,
      manuscript_id: manuscriptId,
      hook_text: v.hook_text.trim(),
      // Prefer the located scene: slideshows and videos built from this
      // hook mine the excerpt for middle beats, and one pasted line
      // starves them. Premise hooks have no scene by design.
      scene_excerpt: premiseRun ? '' : (scene?.excerpt ?? quote.trim()),
      rationale: v.strategy ? `${v.strategy}${v.rationale ? ` — ${v.rationale}` : ''}` : v.rationale ?? '',
      tags: premiseRun ? ['premise'] : [],
      source: 'manual' as const,
    }]);
    setSavedIdx(prev => new Set(prev).add(idx));
    onSaved(h);
  }

  return (
    <div className="bg-surface rounded-card border border-edge p-5">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between gap-3 text-left">
        <div>
          <h3 className="text-sm font-semibold text-content flex items-center gap-2">
            <Quote className="w-4 h-4 text-content-muted" /> Hook workshop
          </h3>
          <p className="text-xs text-content-secondary mt-0.5">
            Paste one quote or moment you love and get a different hook per playbook strategy — compare the framings side by side.
          </p>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-content-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-content-muted shrink-0" />}
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <textarea
            rows={4}
            value={quote}
            onChange={e => setQuote(e.target.value)}
            placeholder={'Paste the quote or short excerpt, verbatim from the book…\ne.g. "You are mine," he growled, hooking her knees and pulling her into him.'}
            className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm focus:border-brand-500 outline-none"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional direction (e.g. lean possessive, he's a vampire boss)…"
              className="flex-1 min-w-52 rounded-control border border-edge-strong px-3 py-2 text-sm focus:border-brand-500 outline-none"
            />
            <button
              onClick={generate}
              disabled={busy || !quote.trim()}
              className="px-4 py-2 rounded-control bg-brand-600 text-brand-fg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {busy ? 'Writing…' : variations.length ? 'Re-roll variations' : 'Write variations'}
            </button>
            <button
              onClick={generatePremise}
              disabled={busy}
              title="Write premise-level hooks from the Catalog facts alone — no quote needed (the 'would you read a book about…' shape)"
              className="px-4 py-2 rounded-control border border-brand-200 text-brand-700 text-sm font-medium hover:bg-brand-50 disabled:opacity-40"
            >
              Premise hooks
            </button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          {sceneStatus === 'found' && scene && (
            <p className="text-[11px] text-emerald-700 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Found the scene in "{scene.chapterTitle}" — variations draw on the full moment, and saved hooks carry it for slideshows.
            </p>
          )}
          {sceneStatus === 'notfound' && (
            <p className="text-[11px] text-amber-700">
              Couldn't find this quote in the linked manuscript — working from the paste and your direction only. If the quote IS in the book, check for typos or paste a longer stretch.
            </p>
          )}

          {variations.length > 0 && (
            <div className="space-y-2 pt-1">
              {variations.map((v, i) => {
                const matches = scanForBannedWords(v.hook_text, bannedActive);
                const saved = savedIdx.has(i);
                return (
                  <div key={i} className="rounded-control border border-edge p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100 mb-1.5">
                          {v.strategy || 'Untitled strategy'}
                        </span>
                        <p className="text-sm text-content">{v.hook_text}</p>
                        {v.rationale && <p className="text-xs text-content-muted mt-1">{v.rationale}</p>}
                        {matches.length > 0 && (
                          <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" /> contains banned {matches.length === 1 ? 'word' : 'words'}: {matches.map(m => `"${m.found}"`).join(', ')} — fixes available after saving
                          </p>
                        )}
                      </div>
                      {saved ? (
                        <span className="text-xs text-emerald-600 flex items-center gap-1 shrink-0"><Check className="w-3.5 h-3.5" /> Saved</span>
                      ) : (
                        <button onClick={() => saveVariation(v, i)}
                          className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-white hover:bg-slate-700 shrink-0">
                          Save
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-content-muted">
                Saved variations join your hook list below with the {scene ? 'located scene' : 'pasted quote'} attached. Re-roll keeps the quote and writes a fresh set.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddHookButton({ userId, bookId, manuscriptId, onAdded }: {
  userId: string; bookId: string; manuscriptId: string | null; onAdded: (h: ContentHook) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  async function add() {
    if (!text.trim()) return;
    const [h] = await insertHooks(userId, [{
      book_id: bookId, manuscript_id: manuscriptId, hook_text: text.trim(),
      scene_excerpt: '', rationale: '', tags: [], source: 'manual',
    }]);
    onAdded(h);
    setText(''); setOpen(false);
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
        <Plus className="w-4 h-4" /> Add hook
      </button>
    );
  }
  return (
    <div className="flex gap-2 items-center">
      <input
        autoFocus
        className="rounded-control border border-edge-strong px-3 py-1.5 text-sm w-72 focus:border-brand-500 outline-none"
        placeholder="Type the hook…"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setOpen(false); }}
      />
      <button onClick={add} className="px-3 py-1.5 rounded-control bg-brand-600 text-brand-fg text-sm hover:bg-brand-700">Save</button>
    </div>
  );
}

// Bulk-import saved moments (e.g. from a spreadsheet of quotes collected
// over time). One moment per paragraph; each becomes a candidate hook and
// we auto-locate its scene in the linked manuscript (free text search).
function ImportMomentsButton({ userId, bookId, manuscriptId, onAdded }: {
  userId: string; bookId: string; manuscriptId: string | null; onAdded: (hooks: ContentHook[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<string | null>(null);

  async function runImport() {
    const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length >= 10).slice(0, 50);
    if (!blocks.length) return;
    const added: ContentHook[] = [];
    for (let i = 0; i < blocks.length; i++) {
      setProgress(`Importing ${i + 1}/${blocks.length}…`);
      let scene = null;
      if (manuscriptId) {
        try { scene = await findSceneForQuote(manuscriptId, blocks[i]); } catch { /* best-effort */ }
      }
      const [h] = await insertHooks(userId, [{
        book_id: bookId, manuscript_id: manuscriptId, hook_text: blocks[i],
        scene_excerpt: scene?.excerpt ?? '', rationale: scene ? `Imported — scene found in "${scene.chapterTitle}"` : 'Imported moment',
        tags: ['imported'], source: 'manual' as const,
      }]);
      added.push(h);
    }
    onAdded(added.reverse());
    setProgress(null); setText(''); setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-content-secondary hover:text-content">
        Import moments
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 bg-surface rounded-card border border-edge p-3">
      <textarea
        rows={5}
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'Paste your saved moments — one per paragraph (blank line between them).\nEach becomes a candidate, and I\'ll find its scene in the linked manuscript automatically.'}
        className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm focus:border-brand-500 outline-none"
      />
      <div className="flex gap-2 items-center">
        <button onClick={runImport} disabled={!!progress || !text.trim()}
          className="px-3 py-1.5 rounded-control bg-slate-800 text-white text-xs hover:bg-slate-700 disabled:opacity-50">
          {progress ?? 'Import'}
        </button>
        <button onClick={() => { setOpen(false); setText(''); }} className="text-xs text-content-secondary hover:text-content">Cancel</button>
      </div>
    </div>
  );
}

function HookCard({ hook, userId, bannedActive, onChanged, onDeleted, onWorkshop }: {
  hook: ContentHook;
  userId: string;
  bannedActive: ActiveBannedWord[];
  onChanged: (h: ContentHook) => void;
  onDeleted: () => void;
  onWorkshop: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hook.hook_text);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [synonymBusy, setSynonymBusy] = useState<string | null>(null);
  const matches = scanForBannedWords(editing ? draft : hook.hook_text, bannedActive);

  async function save(text: string) {
    const updated = await updateHook(hook.id, { hook_text: text.trim() });
    onChanged(updated);
    setEditing(false);
  }

  async function applyFix(match: BannedMatch, kind: 'replacement' | 'mask' | 'synonym') {
    const current = editing ? draft : hook.hook_text;
    let substitute = '';
    if (kind === 'replacement' && match.replacement) substitute = match.replacement;
    else if (kind === 'mask') substitute = maskWord(match.found);
    else {
      setSynonymBusy(match.word);
      try {
        const raw = await runTask({ userId, task: 'synonym', prompt: buildSynonymPrompt(match.word, current), maxTokens: 128 });
        substitute = parseJsonResponse<{ replacement: string }>(raw).replacement || maskWord(match.found);
      } catch {
        substitute = maskWord(match.found);
      } finally {
        setSynonymBusy(null);
      }
    }
    const next = replaceBannedWord(current, match.word, substitute);
    if (editing) setDraft(next);
    else await save(next);
  }

  const statusColors: Record<HookStatus, string> = {
    candidate: 'border-edge',
    approved: 'border-emerald-300 bg-emerald-50/30',
    archived: 'border-edge-soft opacity-60',
  };

  return (
    <div className={`bg-surface rounded-card border p-4 ${statusColors[hook.status]}`}>
      {editing ? (
        <div className="space-y-2">
          <textarea
            rows={2}
            autoFocus
            className="w-full rounded-control border border-edge-strong px-3 py-2 text-sm focus:border-brand-500 outline-none"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => save(draft)} className="px-3 py-1.5 rounded-control bg-brand-600 text-brand-fg text-xs hover:bg-brand-700">Save</button>
            <button onClick={() => { setEditing(false); setDraft(hook.hook_text); }} className="text-xs text-content-secondary hover:text-content">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-content cursor-text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {hook.hook_text}
        </p>
      )}

      {matches.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          {matches.map(m => (
            <span key={m.word} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800">
              "{m.found}" is banned:
              {m.replacement && (
                <button onClick={() => applyFix(m, 'replacement')} className="underline hover:text-amber-950">use "{m.replacement}"</button>
              )}
              <button onClick={() => applyFix(m, 'mask')} title="Accent-mask — fine for ORGANIC captions. Never use in Meta paid ads: Meta rejects masked profanity and repeat violations can restrict your ad account. For ads, use the replacement or AI synonym." className="underline hover:text-amber-950">mask ({maskWord(m.found)}, organic only)</button>
              <button onClick={() => applyFix(m, 'synonym')} disabled={synonymBusy === m.word} className="underline hover:text-amber-950 disabled:opacity-50">
                {synonymBusy === m.word ? 'thinking…' : 'AI synonym'}
              </button>
            </span>
          ))}
        </div>
      )}

      {hook.rationale && <p className="text-xs text-content-muted mt-1.5">{hook.rationale}</p>}
      {hook.tags.length > 0 && <p className="text-[11px] text-content-muted mt-1">{hook.tags.map(t => `#${t}`).join(' ')}</p>}

      <div className="flex items-center gap-2 mt-3">
        {hook.status !== 'approved' ? (
          <button onClick={async () => onChanged(await updateHook(hook.id, { status: 'approved' }))}
            className="text-xs px-2.5 py-1 rounded-full bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
        ) : (
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">Approved</span>
        )}
        <button
          onClick={async () => onChanged(await updateHook(hook.id, { favorite: !hook.favorite }))}
          title={hook.favorite ? 'Unfavorite' : 'Favorite'}
          className={`p-1.5 rounded-control ${hook.favorite ? 'text-amber-500' : 'text-content-faint hover:text-amber-500'}`}
        >
          <Star className={`w-4 h-4 ${hook.favorite ? 'fill-amber-400' : ''}`} />
        </button>
        {hook.status !== 'archived' && (
          <button onClick={async () => onChanged(await updateHook(hook.id, { status: 'archived' }))}
            className="text-xs text-content-muted hover:text-content-secondary">Archive</button>
        )}
        <button onClick={() => onWorkshop(hook.scene_excerpt || hook.hook_text)}
          title="Send to the Hook workshop for strategy variations"
          className="text-xs text-content-muted hover:text-brand-600">Workshop</button>
        <select
          value={hook.test_result}
          onChange={async e => onChanged(await updateHook(hook.id, { test_result: e.target.value as HookTestResult }))}
          title="Mark how this hook performed in real ads/posts — the AI learns from these"
          className={`text-[11px] border rounded-control px-1 py-0.5 bg-surface ${hook.test_result === 'worked' ? 'border-emerald-300 text-emerald-700' : hook.test_result === 'failed' ? 'border-rose-300 text-rose-600' : 'border-edge text-content-muted'}`}
        >
          <option value="untested">untested</option>
          <option value="worked">✓ worked</option>
          <option value="failed">✗ failed</option>
        </select>
        <button
          onClick={async () => { if (!confirm('Delete this hook?')) return; await deleteHook(hook.id); onDeleted(); }}
          className="p-1.5 rounded-control text-content-faint hover:text-rose-600 hover:bg-rose-50 ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {hook.scene_excerpt && (
        <div className="mt-2 border-t border-edge-soft pt-2">
          <button onClick={() => setSceneOpen(v => !v)} className="text-xs text-content-secondary hover:text-content flex items-center gap-1">
            {sceneOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Scene
          </button>
          {sceneOpen && <p className="text-xs text-content-secondary mt-1.5 whitespace-pre-wrap italic">{hook.scene_excerpt}</p>}
        </div>
      )}
    </div>
  );
}

// Chapter HTML → plain text for the extraction prompt.
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
