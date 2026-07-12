import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Upload, Check, ShieldBan, Cpu, BookMarked } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listPlaybookEntries, insertPlaybookEntries, updatePlaybookEntry, deletePlaybookEntry,
  listRules, insertRule, updateRule, deleteRule,
  listDefaultBannedWords, listBannedWordOptouts, setBannedWordOptout,
} from '../api';
import type { PlaybookEntry, PlaybookRule, DefaultBannedWord } from '../types';
import { runJsonTask, invalidateTaskModelCache } from '../lib/ai';
import { buildImportSplitPrompt } from '../lib/prompts';
import ModelSettingsPanel from './ModelSettingsPanel';
import { BUILTIN_STRATEGIES } from '../lib/builtinPlaybook';

// The Hook Playbook: curated hook patterns (imported from Author Ad Copy
// Pro or added by hand), writing/avatar rules, and the banned-word list.
// Everything the module generates carries this content in its prompt.

interface ProposedEntry { title: string; pattern_text: string; example_text: string; tags: string[]; keep: boolean }

export default function PlaybookTab() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<PlaybookEntry[]>([]);
  const [rules, setRules] = useState<PlaybookRule[]>([]);
  const [defaults, setDefaults] = useState<DefaultBannedWord[]>([]);
  const [optouts, setOptouts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      listPlaybookEntries(user.id),
      listRules(user.id),
      listDefaultBannedWords(),
      listBannedWordOptouts(user.id),
    ])
      .then(async ([e, r, d, o]) => {
        if (cancelled) return;
        // Self-heal: every account should carry the default anti-purple-prose
        // rule (the migration-time seed couldn't reach accounts that link by
        // email at login).
        let rules = r;
        if (!r.some(rule => rule.rule_type === 'style')) {
          try {
            const seeded = await insertRule(user.id, 'style',
              'Write in plain, punchy, contemporary social-media voice. No purple prose: no ornate metaphors, no archaic vocabulary, no melodramatic narration. Short sentences. Sound like a real reader talking, not a novelist narrating.');
            rules = [...r, seeded];
          } catch { /* non-fatal */ }
        }
        if (cancelled) return;
        setEntries(e); setRules(rules); setDefaults(d); setOptouts(new Set(o));
      })
      .catch(err => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  if (loading) return <Centered><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></Centered>;
  if (error) return <Centered><p className="text-rose-600 text-sm">{error}</p></Centered>;
  if (!user) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <BuiltinLibraryPanel />
      <ImportPanel
        userId={user.id}
        onImported={added => setEntries(prev => [...added, ...prev])}
      />
      <EntriesPanel userId={user.id} entries={entries} setEntries={setEntries} />
      <RulesPanel userId={user.id} rules={rules} setRules={setRules} kind="style"
        title="Writing rules" hint="Every generation follows these. The anti-purple-prose rule ships by default — add your own voice rules here." />
      <RulesPanel userId={user.id} rules={rules} setRules={setRules} kind="avatar"
        title="Reader avatars" hint="Who the hooks should speak to. Paste avatar frameworks from Author Ad Copy Pro — one per rule." />
      <BannedWordsPanel
        userId={user.id}
        defaults={defaults} optouts={optouts} setOptouts={setOptouts}
        rules={rules} setRules={setRules}
      />
      <details className="bg-white rounded-xl border border-slate-200">
        <summary className="px-5 py-4 cursor-pointer select-none flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Cpu className="w-4 h-4 text-slate-400" /> AI models per task
        </summary>
        <div className="px-5 pb-5">
          <ModelSettingsPanel onSaved={invalidateTaskModelCache} />
        </div>
      </details>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center py-16">{children}</div>;
}

const cardCls = 'bg-white rounded-xl border border-slate-200 p-5';
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none bg-white';

// ---------------- Built-in strategy library ----------------

function BuiltinLibraryPanel() {
  return (
    <details className={cardCls}>
      <summary className="cursor-pointer select-none">
        <span className="text-sm font-semibold text-slate-800 inline-flex items-center gap-2">
          <BookMarked className="w-4 h-4 text-slate-400" /> Built-in strategy library ({BUILTIN_STRATEGIES.length})
        </span>
        <span className="block text-xs text-slate-500 mt-1">
          The tested BookTok hook strategies ship with the app and apply to every scan and generation automatically — for every book, no import needed. Everything below this panel is <em>your</em> additions on top.
        </span>
      </summary>
      <div className="mt-4 space-y-2">
        {BUILTIN_STRATEGIES.map(s => (
          <div key={s.title} className="p-3 rounded-lg border border-slate-100 bg-slate-50/50">
            <p className="text-sm font-medium text-slate-700">{s.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.pattern}</p>
            {s.example && <p className="text-xs text-slate-400 italic mt-0.5">"{s.example}"</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------------- Import ----------------

function ImportPanel({ userId, onImported }: { userId: string; onImported: (added: PlaybookEntry[]) => void }) {
  const [text, setText] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposed, setProposed] = useState<ProposedEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) {
      const mammoth = await import('mammoth/mammoth.browser');
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      setText(prev => (prev ? prev + '\n\n' : '') + result.value);
    } else {
      const raw = await file.text();
      setText(prev => (prev ? prev + '\n\n' : '') + raw);
    }
  }

  async function propose() {
    if (!text.trim()) return;
    setProposing(true); setError(null);
    try {
      const out = await runJsonTask<{ entries: Array<Omit<ProposedEntry, 'keep'>> }>({
        userId, task: 'copy', prompt: buildImportSplitPrompt(text), maxTokens: 4096,
      });
      const list = (out.entries ?? []).filter(e => e.title && e.pattern_text);
      if (!list.length) { setError('No usable entries found in the pasted material.'); return; }
      setProposed(list.map(e => ({ ...e, example_text: e.example_text ?? '', tags: e.tags ?? [], keep: true })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProposing(false);
    }
  }

  async function saveKept() {
    if (!proposed) return;
    const keep = proposed.filter(p => p.keep);
    if (!keep.length) { setProposed(null); return; }
    setSaving(true); setError(null);
    try {
      const added = await insertPlaybookEntries(userId, keep.map(p => ({
        title: p.title, pattern_text: p.pattern_text, example_text: p.example_text,
        tags: p.tags, pen_name_id: null, formats: [], active: true,
      })));
      onImported(added);
      setProposed(null); setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
        <Upload className="w-4 h-4 text-slate-400" /> Import hook patterns
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Paste your monthly hook batch or Author Ad Copy Pro material (or upload .txt / .md / .docx). AI splits it into entries for your review — nothing saves until you approve it.
      </p>
      {!proposed ? (
        <>
          <textarea rows={5} className={inputCls} value={text} onChange={e => setText(e.target.value)}
            placeholder="Paste hook patterns, rules, or reference material here…" />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={propose} disabled={proposing || !text.trim()}
              className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50 flex items-center gap-2">
              {proposing && <Loader2 className="w-4 h-4 animate-spin" />} Propose entries
            </button>
            <label className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer">
              Upload file
              <input type="file" accept=".txt,.md,.docx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f).catch(err => setError((err as Error).message)); e.target.value = ''; }} />
            </label>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {proposed.map((p, i) => (
            <label key={i} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${p.keep ? 'border-pink-300 bg-pink-50/40' : 'border-slate-200 opacity-60'}`}>
              <input type="checkbox" checked={p.keep} className="mt-1"
                onChange={() => setProposed(prev => prev!.map((x, j) => j === i ? { ...x, keep: !x.keep } : x))} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{p.title}</span>
                <span className="block text-xs text-slate-600 mt-0.5">{p.pattern_text}</span>
                {p.example_text && <span className="block text-xs text-slate-400 italic mt-0.5">"{p.example_text}"</span>}
              </span>
            </label>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={saveKept} disabled={saving}
              className="px-4 py-2 rounded-lg bg-pink-600 text-white text-sm font-medium hover:bg-pink-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save {proposed.filter(p => p.keep).length} entries
            </button>
            <button onClick={() => setProposed(null)} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
    </div>
  );
}

// ---------------- Entries ----------------

function EntriesPanel({ userId, entries, setEntries }: {
  userId: string;
  entries: PlaybookEntry[];
  setEntries: React.Dispatch<React.SetStateAction<PlaybookEntry[]>>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [pattern, setPattern] = useState('');

  async function addManual() {
    if (!title.trim() || !pattern.trim()) return;
    const [added] = await insertPlaybookEntries(userId, [{
      title: title.trim(), pattern_text: pattern.trim(), example_text: '',
      tags: [], pen_name_id: null, formats: [], active: true,
    }]);
    setEntries(prev => [added, ...prev]);
    setTitle(''); setPattern(''); setAdding(false);
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Hook patterns ({entries.length})</h3>
        <button onClick={() => setAdding(v => !v)} className="text-sm text-pink-600 hover:text-pink-700 flex items-center gap-1">
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {adding && (
        <div className="mb-4 p-3 rounded-lg border border-slate-200 space-y-2">
          <input className={inputCls} placeholder="Pattern name (e.g. Unhinged Devotion)" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea rows={2} className={inputCls} placeholder="How the pattern works…" value={pattern} onChange={e => setPattern(e.target.value)} />
          <button onClick={addManual} className="px-3 py-1.5 rounded-lg bg-pink-600 text-white text-sm hover:bg-pink-700">Save</button>
        </div>
      )}
      {entries.length === 0 && !adding && (
        <p className="text-sm text-slate-400">No patterns yet — import your Author Ad Copy Pro material above to seed the playbook.</p>
      )}
      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className={`p-3 rounded-lg border ${e.active ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{e.title}</p>
                <p className="text-xs text-slate-600 mt-0.5">{e.pattern_text}</p>
                {e.example_text && <p className="text-xs text-slate-400 italic mt-0.5">"{e.example_text}"</p>}
                {e.tags.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-1">{e.tags.map(t => `#${t}`).join(' ')}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={async () => {
                    const updated = await updatePlaybookEntry(e.id, { active: !e.active });
                    setEntries(prev => prev.map(x => x.id === e.id ? updated : x));
                  }}
                  className={`text-[11px] px-2 py-1 rounded-full border ${e.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'}`}
                >
                  {e.active ? 'Active' : 'Off'}
                </button>
                <button
                  onClick={async () => { if (!confirm('Delete this pattern?')) return; await deletePlaybookEntry(e.id); setEntries(prev => prev.filter(x => x.id !== e.id)); }}
                  className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Style / avatar rules ----------------

function RulesPanel({ userId, rules, setRules, kind, title, hint }: {
  userId: string;
  rules: PlaybookRule[];
  setRules: React.Dispatch<React.SetStateAction<PlaybookRule[]>>;
  kind: 'style' | 'avatar';
  title: string;
  hint: string;
}) {
  const [text, setText] = useState('');
  const mine = rules.filter(r => r.rule_type === kind);

  async function add() {
    if (!text.trim()) return;
    const rule = await insertRule(userId, kind, text.trim());
    setRules(prev => [...prev, rule]);
    setText('');
  }

  return (
    <div className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">{title} ({mine.length})</h3>
      <p className="text-xs text-slate-500 mb-3">{hint}</p>
      <div className="space-y-2 mb-3">
        {mine.map(r => (
          <div key={r.id} className={`flex items-start gap-2 p-3 rounded-lg border ${r.active ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
            <p className="flex-1 text-xs text-slate-600 whitespace-pre-wrap">{r.content}</p>
            <button
              onClick={async () => { const u = await updateRule(r.id, { active: !r.active }); setRules(prev => prev.map(x => x.id === r.id ? u : x)); }}
              className={`text-[11px] px-2 py-1 rounded-full border shrink-0 ${r.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-400'}`}
            >
              {r.active ? 'Active' : 'Off'}
            </button>
            <button
              onClick={async () => { if (!confirm('Delete this rule?')) return; await deleteRule(r.id); setRules(prev => prev.filter(x => x.id !== r.id)); }}
              className="p-1.5 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea rows={2} className={inputCls} value={text} onChange={e => setText(e.target.value)}
          placeholder={kind === 'style' ? 'e.g. Never open a hook with a rhetorical question.' : 'e.g. The reader who wants to be chosen violently — she reads for the moment the hero burns the world down for her.'} />
        <button onClick={add} disabled={!text.trim()}
          className="self-start px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-40">
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------- Banned words ----------------

function BannedWordsPanel({ userId, defaults, optouts, setOptouts, rules, setRules }: {
  userId: string;
  defaults: DefaultBannedWord[];
  optouts: Set<string>;
  setOptouts: React.Dispatch<React.SetStateAction<Set<string>>>;
  rules: PlaybookRule[];
  setRules: React.Dispatch<React.SetStateAction<PlaybookRule[]>>;
}) {
  const [word, setWord] = useState('');
  const [replacement, setReplacement] = useState('');
  const userWords = rules.filter(r => r.rule_type === 'banned_word');

  async function addWord() {
    const w = word.trim().toLowerCase();
    if (!w) return;
    const rule = await insertRule(userId, 'banned_word', w, replacement.trim() || null);
    setRules(prev => [...prev, rule]);
    setWord(''); setReplacement('');
  }

  return (
    <div className={cardCls}>
      <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-2">
        <ShieldBan className="w-4 h-4 text-slate-400" /> Banned words
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Words ad platforms flag. The built-in list applies automatically (click one to disable it for your account); add your own below, with an optional preferred substitute.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {defaults.map(d => {
          const off = optouts.has(d.id);
          return (
            <button
              key={d.id}
              title={off ? `${d.note} — disabled for you, click to re-enable` : `${d.note} — click to disable for your account`}
              onClick={async () => {
                const next = !off;
                setOptouts(prev => { const s = new Set(prev); if (next) s.add(d.id); else s.delete(d.id); return s; });
                try { await setBannedWordOptout(userId, d.id, next); }
                catch { setOptouts(prev => { const s = new Set(prev); if (next) s.delete(d.id); else s.add(d.id); return s; }); }
              }}
              className={`text-xs px-2 py-1 rounded-full border ${off ? 'border-slate-200 text-slate-300 line-through' : 'border-rose-200 bg-rose-50 text-rose-700'}`}
            >
              {d.word}
            </button>
          );
        })}
      </div>
      {userWords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {userWords.map(r => (
            <span key={r.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-purple-200 bg-purple-50 text-purple-700">
              {r.content}{r.replacement ? ` → ${r.replacement}` : ''}
              <button onClick={async () => { await deleteRule(r.id); setRules(prev => prev.filter(x => x.id !== r.id)); }}
                className="text-purple-400 hover:text-rose-600">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} !w-40`} placeholder="Word to ban" value={word} onChange={e => setWord(e.target.value)} />
        <input className={`${inputCls} !w-48`} placeholder="Substitute (optional)" value={replacement} onChange={e => setReplacement(e.target.value)} />
        <button onClick={addWord} disabled={!word.trim()}
          className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-40">
          Add word
        </button>
      </div>
    </div>
  );
}
