import { useRef, useState, type ReactNode } from 'react';
import {
  RotateCcw, ChevronLeft, ChevronRight, ChevronDown, ImagePlus, Loader2, Plus, Trash2, Check,
  Sparkles, Star, Zap, Heart, CalendarClock, CalendarDays, AlertCircle, X,
} from 'lucide-react';
import { transcribeWeeklyReset } from './aiAssist';
import type { PlannerImage } from './ai';
import {
  dedupeResetDraft, QUICK_TASK_MINUTES,
  type ResetDraftItem, type ResetTranscription, type WeeklyReset,
} from './types';

// The Weekly Reset: a once-a-week reflection + capture. Reflective sections are
// free text you read back. Everything actionable goes into ONE brain dump; you
// then tag each item in-app — ★ Priority, ⚡ Quick (auto 15-min), ♥ Feel-good —
// so an item exists exactly once and can never be duplicated across sections.
// Fill it by hand, or snap photo(s) of a handwritten page for Claude (your own
// key) to transcribe; it flags guesses, and nothing is created until you approve.
const REFLECTIVE: { key: 'wins' | 'not_done' | 'drained' | 'feel_more'; label: string; placeholder: string }[] = [
  { key: 'wins', label: 'Wins from last week', placeholder: 'What went well…' },
  { key: 'not_done', label: 'What I didn’t do last week', placeholder: 'What slipped…' },
  { key: 'drained', label: 'What drained my time', placeholder: 'Where the time went…' },
  { key: 'feel_more', label: 'What I want to feel more of', placeholder: 'This week / this month…' },
];

const EMPTY_DRAFT: ResetTranscription = { wins: '', not_done: '', drained: '', feel_more: '', items: [] };

export default function WeeklyResetView({
  weekStart, today, reset, onPrevWeek, onNextWeek, onThisWeek, onSaveReflective, onCreateTasks,
}: {
  weekStart: string;
  today: string;
  reset: WeeklyReset | null;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onSaveReflective: (patch: Partial<Pick<WeeklyReset, 'wins' | 'not_done' | 'drained' | 'feel_more'>>) => void;
  onCreateTasks: (draft: ResetTranscription) => Promise<number>;
}) {
  const [refl, setRefl] = useState({
    wins: reset?.wins ?? '', not_done: reset?.not_done ?? '', drained: reset?.drained ?? '', feel_more: reset?.feel_more ?? '',
  });
  const [draft, setDraft] = useState<ResetTranscription>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  // Which reflective (journal) rows are expanded — collapsed by default, like
  // the Planning tray, so the page stays calm.
  const [openFields, setOpenFields] = useState<Set<string>>(() => new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleField(key: string) {
    setOpenFields(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  const thisWeek = weekStart === currentMonday(today);
  const itemCount = draft.items.filter(i => i.text.trim()).length;

  function saveField(key: 'wins' | 'not_done' | 'drained' | 'feel_more') {
    onSaveReflective({ [key]: refl[key] });
  }

  async function onPickPhotos(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setError(null); setSaved(null); setProgress(null);
    try {
      const images: PlannerImage[] = [];
      for (const f of Array.from(files).slice(0, 8)) {
        if (f.type.startsWith('image/')) images.push(await fileToScaledImage(f));
      }
      if (!images.length) throw new Error('Those didn’t look like photos — try JPG or PNG images.');

      // Transcribe one page at a time and merge (several full photos in one
      // request can exceed the serverless limits). A blurry page that fails
      // doesn't sink the rest.
      const results: ResetTranscription[] = [];
      let failures = 0;
      for (let i = 0; i < images.length; i++) {
        setProgress({ i: i + 1, n: images.length });
        try { results.push(await transcribeWeeklyReset([images[i]])); }
        catch { failures += 1; }
      }
      if (!results.length) throw new Error('Couldn’t read those photos — try clearer, flatter, well-lit pictures.');

      const merged = {
        wins: results.reduce((s, r) => joinText(s, r.wins), refl.wins),
        not_done: results.reduce((s, r) => joinText(s, r.not_done), refl.not_done),
        drained: results.reduce((s, r) => joinText(s, r.drained), refl.drained),
        feel_more: results.reduce((s, r) => joinText(s, r.feel_more), refl.feel_more),
      };
      setRefl(merged);
      onSaveReflective(merged);
      setDraft(d => dedupeResetDraft({ ...d, items: [...d.items, ...results.flatMap(r => r.items)] }));
      if (failures) setError(`Read ${results.length} of ${results.length + failures} photos — the rest were too blurry. Try a clearer shot of those.`);
    } catch (e) {
      setError((e as Error)?.message ?? 'Couldn’t transcribe that photo.');
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function patchItem(i: number, patch: Partial<ResetDraftItem>) {
    setDraft(d => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  }
  function removeItem(i: number) {
    setDraft(d => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }));
  }
  function addItem() {
    setDraft(d => ({ ...d, items: [...d.items, { text: '' }] }));
  }
  // Quick also sets/clears the 15-minute estimate.
  function toggleQuick(i: number, on: boolean) {
    patchItem(i, { quick: on, estimate_minutes: on ? QUICK_TASK_MINUTES : null });
  }

  async function approve() {
    if (itemCount === 0) return;
    setBusy(true); setError(null);
    try {
      // Carry the (edited) journal answers along so they can be snapshotted onto
      // the generated list — the draft's own reflective fields aren't kept in
      // sync with the textareas.
      const n = await onCreateTasks({ ...draft, wins: refl.wins, not_done: refl.not_done, drained: refl.drained, feel_more: refl.feel_more });
      setDraft(EMPTY_DRAFT);
      setSaved(n);
    } catch (e) {
      setError((e as Error)?.message ?? 'Couldn’t create those to-dos.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <RotateCcw className="w-6 h-6 text-violet-500" />
        <h2 className="text-2xl font-bold text-slate-800">Weekly Reset</h2>
      </div>
      <p className="text-sm text-slate-400 mb-5">Reflect on last week and set up this one. Snap a photo of your handwritten page or fill it in here.</p>

      {/* Week navigator */}
      <div className="flex items-center justify-center gap-4 mb-5">
        <button onClick={onPrevWeek} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" title="Previous week"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-sm font-semibold text-slate-700 text-center">
          {weekLabel(weekStart)}
          {thisWeek && <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-violet-600">This week</span>}
        </div>
        <button onClick={onNextWeek} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" title="Next week"><ChevronRight className="w-5 h-5" /></button>
      </div>
      {!thisWeek && (
        <div className="text-center -mt-3 mb-4">
          <button onClick={onThisWeek} className="text-xs font-medium text-violet-600 hover:text-violet-700">Jump to this week</button>
        </div>
      )}

      {/* Add from photo */}
      <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => onPickPhotos(e.target.files)} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 rounded-lg px-3 py-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            {busy ? (progress && progress.n > 1 ? `Reading page ${progress.i} of ${progress.n}…` : 'Reading your reset…') : 'Add from photo'}
          </button>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" /> Transcribes with your own AI key. Photos aren’t stored.
          </p>
        </div>
        {error && (
          <div className="mt-3 flex items-start gap-2 text-sm text-rose-600">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* Reflective journal — collapsible rows so the page stays tidy. */}
      <div className="mb-8 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {REFLECTIVE.map(f => {
          const open = openFields.has(f.key);
          const preview = refl[f.key].trim().replace(/\s+/g, ' ');
          return (
            <div key={f.key}>
              <button onClick={() => toggleField(f.key)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
                {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                <span className="text-sm font-medium text-slate-700 shrink-0">{f.label}</span>
                {!open && (
                  <span className={`ml-auto text-xs truncate ${preview ? 'text-slate-400' : 'text-slate-300'}`}>
                    {preview || 'Tap to add…'}
                  </span>
                )}
              </button>
              {open && (
                <div className="px-4 pb-3">
                  <textarea
                    autoFocus
                    value={refl[f.key]}
                    onChange={e => setRefl(r => ({ ...r, [f.key]: e.target.value }))}
                    onBlur={() => saveField(f.key)}
                    placeholder={f.placeholder}
                    rows={3}
                    className="w-full text-sm rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-violet-300 text-slate-700 placeholder:text-slate-300 resize-y"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Brain dump → tag each item */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Brain dump</h3>
          <p className="text-xs text-slate-400">Everything on your mind. Tag each: <Star className="inline w-3 h-3 text-amber-400 -mt-0.5" /> priority · <Zap className="inline w-3 h-3 text-teal-500 -mt-0.5" /> quick (15m) · <Heart className="inline w-3 h-3 text-rose-400 -mt-0.5" /> feel-good · <CalendarDays className="inline w-3 h-3 text-violet-500 -mt-0.5" /> schedule a day · <CalendarClock className="inline w-3 h-3 text-sky-500 -mt-0.5" /> meeting (date).</p>
        </div>
        {itemCount > 0 && (
          <button
            onClick={approve}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-60 rounded-lg px-3 py-1.5 shrink-0"
          >
            <Check className="w-4 h-4" /> Approve &amp; create {itemCount} to-do{itemCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {saved != null && (
        <div className="my-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="w-4 h-4 shrink-0" />
          Created {saved} to-do{saved === 1 ? '' : 's'} in this week’s <span className="font-medium">Weekly Reset</span> list (under Lists). Ones you gave a day are already scheduled; schedule the rest in Planning — drag on desktop, or use a to-do’s Schedule menu on your phone.
        </div>
      )}

      <ul className="mt-3 rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
        {draft.items.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-slate-400">
            Add a photo above, or add items by hand below. Nothing becomes a to-do until you approve.
          </li>
        ) : draft.items.map((it, i) => (
          <li key={i} className={`flex items-center gap-2 px-3 py-2 ${it.uncertain ? 'bg-amber-50' : ''}`}>
            {it.uncertain && <span title="Claude guessed this — please confirm"><AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /></span>}
            <input
              value={it.text}
              onChange={e => patchItem(i, { text: e.target.value, uncertain: false })}
              placeholder="Describe it…"
              className="flex-1 min-w-0 text-sm bg-transparent outline-none text-slate-700 placeholder:text-slate-300"
            />
            {it.quick && it.estimate_minutes ? <span className="hidden sm:inline text-[11px] text-slate-400 shrink-0">{it.estimate_minutes}m</span> : null}
            {(it.meeting || it.date != null) && (
              <input
                type="date"
                value={it.date ?? ''}
                onChange={e => patchItem(i, { date: e.target.value || null })}
                className="shrink-0 text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600"
                title={it.meeting ? 'Meeting date' : 'Scheduled day'}
              />
            )}
            <TagButton active={!!it.priority} onClick={() => patchItem(i, { priority: !it.priority })} title="Priority (Important)" tone="amber"><Star className="w-3.5 h-3.5" fill={it.priority ? 'currentColor' : 'none'} /></TagButton>
            <TagButton active={!!it.quick} onClick={() => toggleQuick(i, !it.quick)} title="Quick task (15 min)" tone="teal"><Zap className="w-3.5 h-3.5" fill={it.quick ? 'currentColor' : 'none'} /></TagButton>
            <TagButton active={!!it.feel_good} onClick={() => patchItem(i, { feel_good: !it.feel_good })} title="Would feel good" tone="rose"><Heart className="w-3.5 h-3.5" fill={it.feel_good ? 'currentColor' : 'none'} /></TagButton>
            {!it.meeting && (
              <TagButton
                active={it.date != null}
                onClick={() => patchItem(i, { date: it.date != null ? null : today })}
                title="Schedule on a day"
                tone="violet"
              ><CalendarDays className="w-3.5 h-3.5" /></TagButton>
            )}
            <TagButton active={!!it.meeting} onClick={() => patchItem(i, { meeting: !it.meeting })} title="Meeting (set a date)" tone="sky"><CalendarClock className="w-3.5 h-3.5" /></TagButton>
            <button onClick={() => removeItem(i)} className="text-slate-300 hover:text-rose-500 shrink-0" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
      <button onClick={addItem} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-violet-600">
        <Plus className="w-3.5 h-3.5" /> add an item
      </button>
    </div>
  );
}

function TagButton({
  active, onClick, title, tone, children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  tone: 'amber' | 'teal' | 'rose' | 'sky' | 'violet';
  children: ReactNode;
}) {
  const on = tone === 'amber' ? 'text-amber-500 bg-amber-50 ring-amber-200'
    : tone === 'teal' ? 'text-teal-600 bg-teal-50 ring-teal-200'
      : tone === 'sky' ? 'text-sky-600 bg-sky-50 ring-sky-200'
        : tone === 'violet' ? 'text-violet-600 bg-violet-50 ring-violet-200'
          : 'text-rose-500 bg-rose-50 ring-rose-200';
  return (
    <button
      onClick={onClick}
      title={title}
      className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${active ? `${on} ring-1` : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

// --- helpers ---------------------------------------------------------------

function currentMonday(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weekLabel(monday: string): string {
  const start = new Date(monday + 'T00:00:00');
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function joinText(existing: string, added: string): string {
  const a = existing.trim(); const b = added.trim();
  if (!b) return existing;
  if (!a) return b;
  return `${a}\n${b}`;
}

// Read a photo, downscale to Anthropic's recommended max edge, and return base64
// JPEG — keeps the request body small and OCR quality high.
async function fileToScaledImage(file: File, maxDim = 1568): Promise<PlannerImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('Could not read the image.'));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Could not load the image.'));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser can’t process images here.');
  ctx.drawImage(img, 0, 0, w, h);
  const base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
  return { data: base64, media_type: 'image/jpeg' };
}
