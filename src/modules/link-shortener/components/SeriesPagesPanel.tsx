import { useEffect, useState, type ReactNode } from 'react';
import {
  Plus, Loader2, Trash2, ExternalLink, ArrowLeft, Check, ChevronUp, ChevronDown, X,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listSeriesPages, createSeriesPage, updateSeriesPage, deleteSeriesPage,
  listLandingPages, isSlugAvailable,
} from '../api';
import type { LandingPage, SeriesPage } from '../types';
import { isValidSlug, buildShortUrl } from '../utils';
import { BIO_THEMES, DEFAULT_BIO_THEME, bioThemeById } from '../bioThemes';

export default function SeriesPagesPanel() {
  const { user } = useAuth();
  const [series, setSeries] = useState<SeriesPage[]>([]);
  const [books, setBooks] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SeriesPage | 'new' | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([listSeriesPages(user.id), listLandingPages(user.id)])
      .then(([s, b]) => { setSeries(s); setBooks(b); })
      .catch(() => { setSeries([]); setBooks([]); })
      .finally(() => setLoading(false));
  }, [user]);

  function onSaved(s: SeriesPage) {
    setSeries((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [s, ...prev]));
    setEditing(null);
  }

  async function handleDelete(s: SeriesPage) {
    if (!confirm(`Delete the series page /${s.slug}? Its URL will stop working.`)) return;
    try {
      await deleteSeriesPage(s.id);
      setSeries((prev) => prev.filter((p) => p.id !== s.id));
    } catch { /* ignore */ }
  }

  if (editing) {
    return (
      <SeriesEditor
        series={editing === 'new' ? null : editing}
        books={books}
        onCancel={() => setEditing(null)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-slate-800">Series pages</h2>
        <button
          onClick={() => setEditing('new')}
          disabled={books.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> New series
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Bundle several book pages into one shareable URL — each book shows as a cover with its retailer
        icons. Build the individual book pages first, then group them here.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : books.length === 0 ? (
        <p className="text-sm text-slate-400">Create a few book pages first (on the Books tab), then come back to group them into a series.</p>
      ) : series.length === 0 ? (
        <p className="text-sm text-slate-400">No series pages yet.</p>
      ) : (
        <div className="space-y-2">
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.title || `/${s.slug}`}</p>
                <p className="text-xs text-slate-400 font-mono truncate">/{s.slug} · {s.page_ids?.length ?? 0} books</p>
              </div>
              <a href={buildShortUrl(s.slug)} target="_blank" rel="noreferrer" className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-50" title="Open page">
                <ExternalLink className="w-4 h-4" />
              </a>
              <button onClick={() => setEditing(s)} className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Edit</button>
              <button onClick={() => handleDelete(s)} className="p-1.5 text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeriesEditor({
  series, books, onCancel, onSaved,
}: {
  series: SeriesPage | null;
  books: LandingPage[];
  onCancel: () => void;
  onSaved: (s: SeriesPage) => void;
}) {
  const { user } = useAuth();
  const originalSlug = series?.slug ?? '';
  const [slug, setSlug] = useState(series?.slug ?? '');
  const [title, setTitle] = useState(series?.title ?? '');
  const [description, setDescription] = useState(series?.description ?? '');
  const [theme, setTheme] = useState(series?.theme ?? DEFAULT_BIO_THEME);
  const [accentColor, setAccentColor] = useState<string | null>(series?.accent_color ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    Array.isArray(series?.page_ids) ? series!.page_ids.filter((id) => books.some((b) => b.id === id)) : [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booksById = new Map(books.map((b) => [b.id, b]));
  const available = books.filter((b) => !selectedIds.includes(b.id));

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[i], next[j]] = [next[j], next[i]];
    setSelectedIds(next);
  }

  async function handleSave() {
    if (!user) return;
    const s = slug.trim();
    if (!isValidSlug(s)) {
      setError('Use 3–40 letters, numbers, hyphens, or underscores for the URL name.');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Add at least one book to the series.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (s !== originalSlug) {
        const ok = await isSlugAvailable(s);
        if (!ok) {
          setError(`"${s}" is already used by another link or page. Pick a different name.`);
          setSaving(false);
          return;
        }
      }
      const payload = {
        slug: s,
        title: title.trim(),
        description: description.trim(),
        page_ids: selectedIds,
        theme,
        accent_color: accentColor,
      };
      const saved = series
        ? await updateSeriesPage(series.id, payload)
        : await createSeriesPage(user.id, payload);
      onSaved(saved);
    } catch (e: any) {
      setError(/duplicate|unique/i.test(e?.message ?? '') ? 'That URL name is already taken.' : (e?.message ?? 'Failed to save'));
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to series
      </button>

      <div className="space-y-5">
        <Field label="URL name" hint="The series lives at your domain + this name, e.g. yourdomain.com/darkling-series">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.replace(/\s+/g, '-'))}
            placeholder="darkling-series"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </Field>

        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Darkling Series" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </Field>

        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="A short intro shown above the books." className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </Field>

        {/* Books in the series */}
        <div>
          <label className="text-sm font-medium text-slate-700">Books in this series</label>
          <p className="text-xs text-slate-400 mb-2">Order is top-to-bottom on the page. Each book shows its cover + retailer icons.</p>
          {selectedIds.length === 0 ? (
            <p className="text-xs text-slate-400 mb-2">No books added yet.</p>
          ) : (
            <div className="space-y-2 mb-2">
              {selectedIds.map((id, i) => {
                const b = booksById.get(id);
                if (!b) return null;
                return (
                  <div key={id} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                    {b.cover_image_url ? (
                      <img src={b.cover_image_url} alt="" className="w-8 h-11 object-cover rounded shrink-0 bg-slate-100" />
                    ) : <div className="w-8 h-11 rounded shrink-0 bg-slate-100" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{b.title || `/${b.slug}`}</p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">/{b.slug}</p>
                    </div>
                    <div className="flex items-center">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === selectedIds.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                    </div>
                    <button onClick={() => setSelectedIds((ids) => ids.filter((x) => x !== id))} className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) setSelectedIds((ids) => [...ids, e.target.value]); }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">+ Add a book…</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>{b.title || `/${b.slug}`}</option>
              ))}
            </select>
          )}
        </div>

        {/* Theme */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-2 block">Theme</label>
          <div className="flex flex-wrap gap-2">
            {BIO_THEMES.map((th) => {
              const active = theme === th.id;
              return (
                <button key={th.id} type="button" onClick={() => setTheme(th.id)} aria-label={th.name}
                  className={`relative w-[78px] rounded-xl overflow-hidden border-2 transition ${active ? 'border-indigo-500' : 'border-transparent hover:border-slate-300'}`}>
                  <div style={{ background: th.bg }} className="h-10 flex items-end justify-center px-2 pb-1.5">
                    <span style={{ background: th.surface }} className="block w-full h-2.5 rounded-sm shadow-sm" />
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 bg-white">
                    <span className="text-[10px] font-medium text-slate-700">{th.name}</span>
                    <span style={{ background: th.accent }} className="w-2 h-2 rounded-full" />
                  </div>
                  {active && <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-indigo-500 text-white grid place-items-center"><Check className="w-2.5 h-2.5" /></span>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Accent color</label>
            <input type="color" value={accentColor || bioThemeById(theme).accent} onChange={(e) => setAccentColor(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5" />
            {accentColor && <button onClick={() => setAccentColor(null)} className="text-xs text-slate-500 hover:underline">Use theme default</button>}
          </div>
        </div>

        {error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {series ? 'Save changes' : 'Create series'}
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-1">{hint}</p>}
      <div className={hint ? '' : 'mt-1'}>{children}</div>
    </div>
  );
}
