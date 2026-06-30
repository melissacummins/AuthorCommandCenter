import { useRef, useState } from 'react';
import {
  RotateCcw, ChevronLeft, ChevronRight, ImagePlus, Loader2, Plus, Trash2, Check,
  Sparkles, Star, Clock, AlertCircle, X,
} from 'lucide-react';
import { transcribeWeeklyReset } from './aiAssist';
import type { PlannerImage } from './ai';
import {
  RESET_SECTIONS, dedupeResetDraft,
  type ResetSection, type ResetDraftItem, type ResetTranscription, type WeeklyReset,
} from './types';

// The Weekly Reset: a once-a-week reflection + capture. Reflective sections are
// free text you read back; actionable sections become to-dos when you approve.
// You can fill it by hand or snap photo(s) of a handwritten page — Claude (your
// own key) transcribes it, flags anything it guessed, and you confirm before
// anything is created.
const REFLECTIVE: { key: 'wins' | 'not_done' | 'drained' | 'feel_more'; label: string; placeholder: string }[] = [
  { key: 'wins', label: 'Wins from last week', placeholder: 'What went well…' },
  { key: 'not_done', label: 'What I didn’t do last week', placeholder: 'What slipped…' },
  { key: 'drained', label: 'What drained my time', placeholder: 'Where the time went…' },
  { key: 'feel_more', label: 'What I want to feel more of', placeholder: 'This week / this month…' },
];

const EMPTY_DRAFT: ResetTranscription = {
  wins: '', not_done: '', drained: '', feel_more: '',
  brain_dump: [], priorities: [], feel_good: [], quick: [], meetings: [],
};

const ACTIONABLE: ResetSection[] = ['brain_dump', 'priorities', 'feel_good', 'quick', 'meetings'];

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
  // Reflective text — initialised once from the loaded reset (the parent
  // remounts this view per week, so the prop is final at mount).
  const [refl, setRefl] = useState({
    wins: reset?.wins ?? '', not_done: reset?.not_done ?? '', drained: reset?.drained ?? '', feel_more: reset?.feel_more ?? '',
  });
  // Actionable drafts awaiting approval (from transcription or manual entry).
  const [draft, setDraft] = useState<ResetTranscription>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const thisWeek = weekStart === currentMonday(today);
  const draftCount = ACTIONABLE.reduce((n, s) => n + draft[s].filter(i => i.text.trim()).length, 0);

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

      // Transcribe ONE page at a time and merge. Sending several full photos in
      // a single request can exceed the serverless size/time limits (which is
      // why multiple-at-once failed); per-page keeps each request small and
      // fast, and pages of one reset combine cleanly. A blurry page that fails
      // doesn't sink the others.
      const results: ResetTranscription[] = [];
      let failures = 0;
      for (let i = 0; i < images.length; i++) {
        setProgress({ i: i + 1, n: images.length });
        try { results.push(await transcribeWeeklyReset([images[i]])); }
        catch { failures += 1; }
      }
      if (!results.length) throw new Error('Couldn’t read those photos — try clearer, flatter, well-lit pictures.');

      const t = results.reduce<ResetTranscription>((acc, r) => ({
        wins: joinText(acc.wins, r.wins), not_done: joinText(acc.not_done, r.not_done),
        drained: joinText(acc.drained, r.drained), feel_more: joinText(acc.feel_more, r.feel_more),
        brain_dump: [...acc.brain_dump, ...r.brain_dump],
        priorities: [...acc.priorities, ...r.priorities],
        feel_good: [...acc.feel_good, ...r.feel_good],
        quick: [...acc.quick, ...r.quick],
        meetings: [...acc.meetings, ...r.meetings],
      }), EMPTY_DRAFT);

      // Reflective text → append into the fields (and persist), so a second
      // photo or manual edits add to what's there rather than replacing it.
      const merged = {
        wins: joinText(refl.wins, t.wins), not_done: joinText(refl.not_done, t.not_done),
        drained: joinText(refl.drained, t.drained), feel_more: joinText(refl.feel_more, t.feel_more),
      };
      setRefl(merged);
      onSaveReflective(merged);
      // Actionable items → append to the draft, then de-dupe so an item that
      // appears in the brain dump AND a more specific section shows up once.
      setDraft(d => dedupeResetDraft({
        ...d,
        brain_dump: [...d.brain_dump, ...t.brain_dump],
        priorities: [...d.priorities, ...t.priorities],
        feel_good: [...d.feel_good, ...t.feel_good],
        quick: [...d.quick, ...t.quick],
        meetings: [...d.meetings, ...t.meetings],
      }));
      if (failures) setError(`Read ${results.length} of ${results.length + failures} photos — the rest were too blurry to transcribe. Try a clearer shot of those.`);
    } catch (e) {
      setError((e as Error)?.message ?? 'Couldn’t transcribe that photo.');
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function updateItem(section: ResetSection, i: number, patch: Partial<ResetDraftItem>) {
    setDraft(d => ({ ...d, [section]: d[section].map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  }
  function removeItem(section: ResetSection, i: number) {
    setDraft(d => ({ ...d, [section]: d[section].filter((_, idx) => idx !== i) }));
  }
  function addItem(section: ResetSection) {
    setDraft(d => ({ ...d, [section]: [...d[section], { text: '' }] }));
  }

  async function approve() {
    if (draftCount === 0) return;
    setBusy(true); setError(null);
    try {
      const n = await onCreateTasks(draft);
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
        <div className="flex items-center gap-3">
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

      {/* Reflective sections */}
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {REFLECTIVE.map(f => (
          <div key={f.key}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{f.label}</label>
            <textarea
              value={refl[f.key]}
              onChange={e => setRefl(r => ({ ...r, [f.key]: e.target.value }))}
              onBlur={() => saveField(f.key)}
              placeholder={f.placeholder}
              rows={3}
              className="w-full text-sm rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-violet-300 text-slate-700 placeholder:text-slate-300 resize-y"
            />
          </div>
        ))}
      </div>

      {/* Actionable sections (drafts → to-dos) */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-700">To plan this week</h3>
        {draftCount > 0 && (
          <button
            onClick={approve}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-60 rounded-lg px-3 py-1.5"
          >
            <Check className="w-4 h-4" /> Approve &amp; create {draftCount} to-do{draftCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {saved != null && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="w-4 h-4 shrink-0" />
          Created {saved} to-do{saved === 1 ? '' : 's'} — find them in your planner. Open any to-do and use Schedule to put it on a day.
        </div>
      )}

      {draftCount === 0 && saved == null && (
        <p className="text-sm text-slate-400 mb-4">
          Add a photo above, or use <span className="font-medium">+ add</span> under a section to capture items by hand. Nothing becomes a to-do until you approve it.
        </p>
      )}

      <div className="space-y-5">
        {RESET_SECTIONS.map(sec => (
          <DraftSectionCard
            key={sec.key}
            section={sec.key}
            label={sec.label}
            hint={sec.hint}
            items={draft[sec.key]}
            onUpdate={(i, patch) => updateItem(sec.key, i, patch)}
            onRemove={i => removeItem(sec.key, i)}
            onAdd={() => addItem(sec.key)}
          />
        ))}
      </div>
    </div>
  );
}

function DraftSectionCard({
  section, label, hint, items, onUpdate, onRemove, onAdd,
}: {
  section: ResetSection;
  label: string;
  hint: string;
  items: ResetDraftItem[];
  onUpdate: (i: number, patch: Partial<ResetDraftItem>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
}) {
  const showEstimate = section === 'priorities' || section === 'quick';
  const showDate = section === 'meetings';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline gap-2 mb-2">
        {section === 'priorities' && <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
        <h4 className="text-sm font-semibold text-slate-700">{label}</h4>
        <span className="text-xs text-slate-400">{hint}</span>
        {items.length > 0 && <span className="ml-auto text-xs text-slate-400">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 mb-1">Nothing yet.</p>
      ) : (
        <ul className="space-y-1.5 mb-1">
          {items.map((it, i) => (
            <li
              key={i}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 ${it.uncertain ? 'bg-amber-50 ring-1 ring-amber-200' : ''}`}
            >
              {it.uncertain && <span title="Claude guessed this — please confirm"><AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /></span>}
              <input
                value={it.text}
                onChange={e => onUpdate(i, { text: e.target.value, uncertain: false })}
                placeholder="Describe it…"
                className="flex-1 min-w-0 text-sm bg-transparent outline-none text-slate-700 placeholder:text-slate-300"
              />
              {showEstimate && (
                <span className="inline-flex items-center gap-1 shrink-0 text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  <input
                    type="number"
                    min={0}
                    value={it.estimate_minutes ?? ''}
                    onChange={e => onUpdate(i, { estimate_minutes: e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null })}
                    placeholder="min"
                    className="w-14 text-xs border border-slate-200 rounded px-1.5 py-0.5"
                  />
                </span>
              )}
              {showDate && (
                <input
                  type="date"
                  value={it.date ?? ''}
                  onChange={e => onUpdate(i, { date: e.target.value || null })}
                  className="shrink-0 text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600"
                />
              )}
              <button onClick={() => onRemove(i)} className="text-slate-300 hover:text-rose-500 shrink-0" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-violet-600">
        <Plus className="w-3.5 h-3.5" /> add
      </button>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

// Monday (local) of the week containing `iso`. Mirrors weekStartISO in types,
// kept local to avoid a circular import of the date helpers here.
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
