import { useEffect, useRef, useState } from 'react';
import { Anchor, Loader2, Play, Square, Star, Trash2, ChevronDown, ChevronRight, ShieldAlert, Plus } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import type { Book } from '../../catalog/types';
import type { Manuscript } from '../../writing/types';
import { listChapters } from '../../writing/api';
import {
  listHooks, insertHooks, updateHook, deleteHook, deleteCandidateHooks,
  getRunningScan, createScan, updateScan,
  listPlaybookEntries, listRules, listDefaultBannedWords, listBannedWordOptouts,
} from '../api';
import type { ContentHook, HookCandidate, WrittenHook, HookStatus } from '../types';
import { runJsonTask, runTask, getTaskModel } from '../lib/ai';
import {
  buildPreamble, buildExtractPrompt, buildRankPrompt, buildVerifyPrompt, buildSynonymPrompt,
  parseJsonResponse, type HookVerdict,
} from '../lib/prompts';
import ScanModelPickers from './ScanModelPickers';
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
      const system = buildPreamble({ book, entries: activeEntries, rules: activeRules, bannedWords: banned });

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

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!user) return null;

  const visible = statusFilter === 'all' ? hooks : hooks.filter(h => h.status === statusFilter);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Anchor className="w-4 h-4 text-slate-400" /> Manuscript scan
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {manuscript
                ? `Scans "${manuscript.title}" chapter by chapter and builds your hook list. You start it; nothing runs on its own.`
                : 'Link a manuscript to this book in the Writing module to enable scanning.'}
            </p>
          </div>
          {!scanning ? (
            <button
              onClick={runScan}
              disabled={!manuscript}
              className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-40 flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> {resumable ? 'Resume scan' : 'Scan manuscript'}
            </button>
          ) : (
            <button
              onClick={() => { cancelRef.current = true; }}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
        {progress && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>
                {progress.phase === 'chapters' ? `Reading chapter ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                  : progress.phase === 'ranking' ? 'Writing hooks from the strongest moments…'
                  : `Fact-checking hook ${Math.min(progress.done + 1, progress.total)} of ${progress.total} against its scene…`}
              </span>
              {progress.phase !== 'ranking' && <span>{Math.round((progress.done / progress.total) * 100)}%</span>}
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full bg-pink-500 transition-all ${progress.phase === 'ranking' ? 'animate-pulse w-full' : ''}`}
                style={progress.phase !== 'ranking' ? { width: `${(progress.done / progress.total) * 100}%` } : undefined}
              />
            </div>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
        {playbookEmpty && !scanning && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Your playbook has no hook patterns yet — scans work dramatically better after you import your material in the Playbook tab.
          </p>
        )}
        <div className="mt-3 border-t border-slate-100 pt-3">
          <ScanModelPickers disabled={scanning} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['all', 'candidate', 'approved', 'archived'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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
              className="text-xs text-slate-400 hover:text-rose-600"
            >
              Clear candidates
            </button>
          )}
          <AddHookButton userId={user.id} bookId={book.id} manuscriptId={manuscript?.id ?? null} onAdded={h => setHooks(prev => [h, ...prev])} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <p className="text-slate-500 text-sm">
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
            />
          ))}
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
      <button onClick={() => setOpen(true)} className="text-sm text-pink-600 hover:text-pink-700 flex items-center gap-1">
        <Plus className="w-4 h-4" /> Add hook
      </button>
    );
  }
  return (
    <div className="flex gap-2 items-center">
      <input
        autoFocus
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-72 focus:border-pink-500 outline-none"
        placeholder="Type the hook…"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setOpen(false); }}
      />
      <button onClick={add} className="px-3 py-1.5 rounded-lg bg-pink-600 text-white text-sm hover:bg-pink-700">Save</button>
    </div>
  );
}

function HookCard({ hook, userId, bannedActive, onChanged, onDeleted }: {
  hook: ContentHook;
  userId: string;
  bannedActive: ActiveBannedWord[];
  onChanged: (h: ContentHook) => void;
  onDeleted: () => void;
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
    candidate: 'border-slate-200',
    approved: 'border-emerald-300 bg-emerald-50/30',
    archived: 'border-slate-100 opacity-60',
  };

  return (
    <div className={`bg-white rounded-xl border p-4 ${statusColors[hook.status]}`}>
      {editing ? (
        <div className="space-y-2">
          <textarea
            rows={2}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 outline-none"
            value={draft}
            onChange={e => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => save(draft)} className="px-3 py-1.5 rounded-lg bg-pink-600 text-white text-xs hover:bg-pink-700">Save</button>
            <button onClick={() => { setEditing(false); setDraft(hook.hook_text); }} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-800 cursor-text" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
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
              <button onClick={() => applyFix(m, 'mask')} className="underline hover:text-amber-950">mask ({maskWord(m.found)})</button>
              <button onClick={() => applyFix(m, 'synonym')} disabled={synonymBusy === m.word} className="underline hover:text-amber-950 disabled:opacity-50">
                {synonymBusy === m.word ? 'thinking…' : 'AI synonym'}
              </button>
            </span>
          ))}
        </div>
      )}

      {hook.rationale && <p className="text-xs text-slate-400 mt-1.5">{hook.rationale}</p>}
      {hook.tags.length > 0 && <p className="text-[11px] text-slate-400 mt-1">{hook.tags.map(t => `#${t}`).join(' ')}</p>}

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
          className={`p-1.5 rounded-md ${hook.favorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'}`}
        >
          <Star className={`w-4 h-4 ${hook.favorite ? 'fill-amber-400' : ''}`} />
        </button>
        {hook.status !== 'archived' && (
          <button onClick={async () => onChanged(await updateHook(hook.id, { status: 'archived' }))}
            className="text-xs text-slate-400 hover:text-slate-600">Archive</button>
        )}
        <button
          onClick={async () => { if (!confirm('Delete this hook?')) return; await deleteHook(hook.id); onDeleted(); }}
          className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {hook.scene_excerpt && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <button onClick={() => setSceneOpen(v => !v)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            {sceneOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Scene
          </button>
          {sceneOpen && <p className="text-xs text-slate-600 mt-1.5 whitespace-pre-wrap italic">{hook.scene_excerpt}</p>}
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
