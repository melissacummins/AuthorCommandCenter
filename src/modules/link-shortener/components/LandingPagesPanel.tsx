import { useEffect, useState, type ReactNode } from 'react';
import {
  Plus, Loader2, Trash2, ExternalLink, ArrowLeft, Sparkles, GripVertical, X, Check,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listLandingPages, createLandingPage, updateLandingPage, deleteLandingPage,
  fetchOgForUrl, isSlugAvailable,
} from '../api';
import type { BioButton, LandingPage } from '../types';
import { isValidSlug, normalizeUrl, isValidUrl, buildShortUrl } from '../utils';
import { BIO_THEMES, DEFAULT_BIO_THEME, bioThemeById } from '../bioThemes';

// Friendly button label guessed from a retailer URL's host.
function retailerLabel(url: string): string {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('amazon') || host.includes('amzn')) return 'Amazon';
    if (host.includes('books.apple') || host.includes('apple.')) return 'Apple Books';
    if (host.includes('kobo')) return 'Kobo';
    if (host.includes('barnesandnoble') || host.includes('bn.com')) return 'Barnes & Noble';
    if (host.includes('play.google')) return 'Google Play';
    if (host.includes('audible')) return 'Audible';
    if (host.includes('smashwords')) return 'Smashwords';
    if (host.includes('bookbub')) return 'BookBub';
    return host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase());
  } catch {
    return 'Buy now';
  }
}

interface DraftState {
  slug: string;
  sourceUrl: string;
  title: string;
  description: string;
  coverUrl: string;
  buttons: BioButton[];
  theme: string;
  accentColor: string | null;
}

const EMPTY_DRAFT: DraftState = {
  slug: '', sourceUrl: '', title: '', description: '', coverUrl: '',
  buttons: [], theme: DEFAULT_BIO_THEME, accentColor: null,
};

export default function LandingPagesPanel() {
  const { user } = useAuth();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LandingPage | 'new' | null>(null);

  useEffect(() => {
    if (!user) return;
    listLandingPages(user.id)
      .then(setPages)
      .catch(() => setPages([]))
      .finally(() => setLoading(false));
  }, [user]);

  function onSaved(page: LandingPage) {
    setPages((prev) => {
      const exists = prev.some((p) => p.id === page.id);
      return exists ? prev.map((p) => (p.id === page.id ? page : p)) : [page, ...prev];
    });
    setEditing(null);
  }

  async function handleDelete(page: LandingPage) {
    if (!confirm(`Delete the landing page /${page.slug}? Its URL will stop working.`)) return;
    try {
      await deleteLandingPage(page.id);
      setPages((prev) => prev.filter((p) => p.id !== page.id));
    } catch {
      // ignore
    }
  }

  if (editing) {
    return (
      <LandingPageEditor
        page={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-slate-800">Book landing pages</h2>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New page
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        A shareable page for one book — cover, blurb, and a stack of retailer buttons — at a clean URL on
        your domain. Paste the book's first retail link and we'll pull the cover and details for you.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : pages.length === 0 ? (
        <p className="text-sm text-slate-400">No landing pages yet. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2.5">
              {p.cover_image_url ? (
                <img src={p.cover_image_url} alt="" className="w-9 h-12 object-cover rounded shrink-0 bg-slate-100" />
              ) : (
                <div className="w-9 h-12 rounded shrink-0 bg-slate-100" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{p.title || `/${p.slug}`}</p>
                <p className="text-xs text-slate-400 font-mono truncate">/{p.slug} · {p.buttons?.length ?? 0} buttons</p>
              </div>
              <a
                href={buildShortUrl(p.slug)}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-50"
                title="Open page"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => setEditing(p)}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(p)}
                className="p-1.5 text-rose-500 border border-rose-200 rounded-lg hover:bg-rose-50"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LandingPageEditor({
  page, onCancel, onSaved,
}: {
  page: LandingPage | null;
  onCancel: () => void;
  onSaved: (p: LandingPage) => void;
}) {
  const { user } = useAuth();
  const originalSlug = page?.slug ?? '';
  const [draft, setDraft] = useState<DraftState>(
    page
      ? {
          slug: page.slug,
          sourceUrl: page.source_url ?? '',
          title: page.title ?? '',
          description: page.description ?? '',
          coverUrl: page.cover_image_url ?? '',
          buttons: Array.isArray(page.buttons) ? page.buttons : [],
          theme: page.theme ?? DEFAULT_BIO_THEME,
          accentColor: page.accent_color ?? null,
        }
      : EMPTY_DRAFT,
  );
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleFetch() {
    const url = draft.sourceUrl.trim();
    if (!url) return;
    setFetching(true);
    setError(null);
    try {
      const og = await fetchOgForUrl(url);
      setDraft((d) => ({
        ...d,
        title: d.title || (og?.title ?? ''),
        description: d.description || (og?.description ?? ''),
        coverUrl: d.coverUrl || (og?.image ?? ''),
        buttons: d.buttons.length > 0 ? d.buttons : [{ label: retailerLabel(url), url: normalizeUrl(url) }],
      }));
      if (!og) setError("Couldn't read details from that link — fill them in manually below.");
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setFetching(false);
    }
  }

  function addButton() {
    set('buttons', [...draft.buttons, { label: '', url: '' }]);
  }
  function updateButton(i: number, patch: Partial<BioButton>) {
    set('buttons', draft.buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeButton(i: number) {
    set('buttons', draft.buttons.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!user) return;
    const slug = draft.slug.trim();
    if (!isValidSlug(slug)) {
      setError('Use 3–40 letters, numbers, hyphens, or underscores for the URL name.');
      return;
    }
    const buttons = draft.buttons
      .map((b) => ({ label: b.label.trim(), url: b.url.trim() ? normalizeUrl(b.url) : '' }))
      .filter((b) => b.label && b.url && isValidUrl(b.url));
    setSaving(true);
    setError(null);
    try {
      if (slug !== originalSlug) {
        const available = await isSlugAvailable(slug);
        if (!available) {
          setError(`"${slug}" is already used by another link or page. Pick a different name.`);
          setSaving(false);
          return;
        }
      }
      const payload = {
        slug,
        title: draft.title.trim(),
        description: draft.description.trim(),
        cover_image_url: draft.coverUrl.trim() || null,
        source_url: draft.sourceUrl.trim(),
        buttons,
        theme: draft.theme,
        accent_color: draft.accentColor,
      };
      const saved = page
        ? await updateLandingPage(page.id, payload)
        : await createLandingPage(user.id, payload);
      onSaved(saved);
    } catch (e: any) {
      setError(/duplicate|unique/i.test(e?.message ?? '') ? 'That URL name is already taken.' : (e?.message ?? 'Failed to save'));
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to pages
      </button>

      <div className="space-y-5">
        {/* Auto-fill */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <label className="text-sm font-medium text-slate-700">Pull from a retail link</label>
          <p className="text-xs text-slate-500 mb-2">Paste the book's first store link — we'll grab the cover, title, and blurb.</p>
          <div className="flex gap-2">
            <input
              value={draft.sourceUrl}
              onChange={(e) => set('sourceUrl', e.target.value)}
              placeholder="https://www.amazon.com/dp/…"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={handleFetch}
              disabled={fetching || !draft.sourceUrl.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Fetch
            </button>
          </div>
        </div>

        <Field label="URL name" hint="The page lives at your domain + this name, e.g. yourdomain.com/forbidden">
          <input
            value={draft.slug}
            onChange={(e) => set('slug', e.target.value.replace(/\s+/g, '-'))}
            placeholder="forbidden"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </Field>

        <Field label="Title">
          <input
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Book title"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            placeholder="A short blurb or hook for the book."
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </Field>

        <Field label="Cover image URL">
          <div className="flex items-start gap-3">
            <input
              value={draft.coverUrl}
              onChange={(e) => set('coverUrl', e.target.value)}
              placeholder="https://…/cover.jpg"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {draft.coverUrl.trim() && (
              <img src={draft.coverUrl} alt="" className="w-12 h-16 object-cover rounded border border-slate-200 bg-slate-100 shrink-0" />
            )}
          </div>
        </Field>

        {/* Buttons */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">Retailer buttons</label>
            <button onClick={addButton} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add button
            </button>
          </div>
          {draft.buttons.length === 0 ? (
            <p className="text-xs text-slate-400">No buttons yet. Add one per store (Amazon, Apple, Kobo…).</p>
          ) : (
            <div className="space-y-2">
              {draft.buttons.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />
                  <input
                    value={b.label}
                    onChange={(e) => updateButton(i, { label: e.target.value })}
                    placeholder="Label (e.g. Amazon)"
                    className="w-36 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <input
                    value={b.url}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                    placeholder="https://…"
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button onClick={() => removeButton(i)} className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Theme */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-2 block">Theme</label>
          <div className="flex flex-wrap gap-2">
            {BIO_THEMES.map((th) => {
              const active = draft.theme === th.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => set('theme', th.id)}
                  aria-label={th.name}
                  className={`relative w-[78px] rounded-xl overflow-hidden border-2 transition ${active ? 'border-indigo-500' : 'border-transparent hover:border-slate-300'}`}
                >
                  <div style={{ background: th.bg }} className="h-10 flex items-end justify-center px-2 pb-1.5">
                    <span style={{ background: th.surface }} className="block w-full h-2.5 rounded-sm shadow-sm" />
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 bg-white">
                    <span className="text-[10px] font-medium text-slate-700">{th.name}</span>
                    <span style={{ background: th.accent }} className="w-2 h-2 rounded-full" />
                  </div>
                  {active && (
                    <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-indigo-500 text-white grid place-items-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Accent color</label>
            <input
              type="color"
              value={draft.accentColor || bioThemeById(draft.theme).accent}
              onChange={(e) => set('accentColor', e.target.value)}
              className="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5"
            />
            {draft.accentColor && (
              <button onClick={() => set('accentColor', null)} className="text-xs text-slate-500 hover:underline">
                Use theme default
              </button>
            )}
          </div>
        </div>

        {error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {page ? 'Save changes' : 'Create page'}
          </button>
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50">
            Cancel
          </button>
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
