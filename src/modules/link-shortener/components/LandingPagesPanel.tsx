import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  Plus, Loader2, Trash2, ExternalLink, ArrowLeft, Sparkles, GripVertical, X, Check, Upload, Star,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listLandingPages, createLandingPage, updateLandingPage, deleteLandingPage,
  fetchOgForUrl, isSlugAvailable, uploadBioImage, listSeriesPages,
} from '../api';
import type { BioButton, BookTextMode, CrossSellLabel, LandingPage, ReviewItem, SeriesPage } from '../types';
import FormattedTextarea from './FormattedTextarea';
import { isValidSlug, normalizeUrl, isValidUrl, buildShortUrl } from '../utils';
import { BIO_THEMES, DEFAULT_BIO_THEME, bioThemeById } from '../bioThemes';

// Canonical retailer names offered in the picker, so labels are consistent
// and match the store the link points at.
const KNOWN_RETAILERS = [
  'Amazon', 'Apple Books', 'Barnes & Noble', 'Kobo', 'Google Play Books',
  'Overdrive', 'Bookshop.org', 'Audible', 'Smashwords', 'BookBub', 'Everand', 'Books2Read',
];

// Friendly button label guessed from a retailer URL's host (matches a
// KNOWN_RETAILERS name when possible).
function retailerLabel(url: string): string {
  try {
    const host = new URL(normalizeUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('amazon') || host.includes('amzn')) return 'Amazon';
    if (host.includes('audible')) return 'Audible';
    if (host.includes('books.apple') || host.includes('apple.')) return 'Apple Books';
    if (host.includes('barnesandnoble') || host.includes('bn.com')) return 'Barnes & Noble';
    if (host.includes('kobo')) return 'Kobo';
    if (host.includes('play.google')) return 'Google Play Books';
    if (host.includes('overdrive') || host.includes('libbyapp')) return 'Overdrive';
    if (host.includes('bookshop.org')) return 'Bookshop.org';
    if (host.includes('smashwords')) return 'Smashwords';
    if (host.includes('bookbub')) return 'BookBub';
    if (host.includes('everand') || host.includes('scribd')) return 'Everand';
    if (host.includes('books2read') || host.includes('books2read.com')) return 'Books2Read';
    return host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase());
  } catch {
    return 'Buy now';
  }
}

interface DraftState {
  slug: string;
  sourceUrl: string;
  title: string;
  headline: string;
  description: string;
  pageTextMode: BookTextMode;
  pageTextCustom: string;
  coverUrl: string;
  buttons: BioButton[];
  reviews: ReviewItem[];
  seriesPageId: string | null;
  crossSellLabel: CrossSellLabel;
  sampleUrl: string;
  sampleLabel: string;
  theme: string;
  accentColor: string | null;
}

const EMPTY_DRAFT: DraftState = {
  slug: '', sourceUrl: '', title: '', headline: '', description: '',
  pageTextMode: 'description', pageTextCustom: '', coverUrl: '',
  buttons: [], reviews: [], seriesPageId: null, crossSellLabel: 'series',
  sampleUrl: '', sampleLabel: 'Read a sample',
  theme: DEFAULT_BIO_THEME, accentColor: null,
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
          headline: page.headline ?? '',
          description: page.description ?? '',
          pageTextMode: page.page_text_mode ?? 'description',
          pageTextCustom: page.page_text_custom ?? '',
          coverUrl: page.cover_image_url ?? '',
          buttons: Array.isArray(page.buttons) ? page.buttons : [],
          reviews: Array.isArray(page.reviews) ? page.reviews : [],
          seriesPageId: page.series_page_id ?? null,
          crossSellLabel: page.cross_sell_label ?? 'series',
          sampleUrl: page.sample_url ?? '',
          sampleLabel: page.sample_label || 'Read a sample',
          theme: page.theme ?? DEFAULT_BIO_THEME,
          accentColor: page.accent_color ?? null,
        }
      : EMPTY_DRAFT,
  );
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seriesOptions, setSeriesOptions] = useState<SeriesPage[]>([]);
  // Rows the author switched to a custom (non-listed) retailer name.
  const [customRows, setCustomRows] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!user) return;
    listSeriesPages(user.id).then(setSeriesOptions).catch(() => setSeriesOptions([]));
  }, [user]);

  async function handleCoverUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) { setError('Cover must be 2MB or smaller.'); return; }
    setCoverBusy(true);
    setError(null);
    try {
      const url = await uploadBioImage(user.id, file);
      set('coverUrl', url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed');
    } finally {
      setCoverBusy(false);
    }
  }

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

  function addReview() {
    set('reviews', [...draft.reviews, { stars: 5, quote: '', attribution: '' }]);
  }
  function updateReview(i: number, patch: Partial<ReviewItem>) {
    set('reviews', draft.reviews.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeReview(i: number) {
    set('reviews', draft.reviews.filter((_, idx) => idx !== i));
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
    const reviews = draft.reviews
      .map((r) => ({
        stars: Math.max(1, Math.min(5, Math.round(Number(r.stars) || 5))),
        quote: r.quote.trim(),
        attribution: r.attribution.trim(),
      }))
      .filter((r) => r.quote);
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
        headline: draft.headline.trim(),
        description: draft.description.trim(),
        page_text_mode: draft.pageTextMode,
        page_text_custom: draft.pageTextCustom.trim(),
        cover_image_url: draft.coverUrl.trim() || null,
        source_url: draft.sourceUrl.trim(),
        buttons,
        reviews,
        series_page_id: draft.seriesPageId,
        cross_sell_label: draft.crossSellLabel,
        sample_url: draft.sampleUrl.trim() ? normalizeUrl(draft.sampleUrl) : null,
        sample_label: draft.sampleLabel.trim() || 'Read a sample',
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

        <Field label="Title (book name)" hint="The book's name — shown as the heading on the page and on bio book cards.">
          <input
            value={draft.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Vicious Beast"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </Field>

        <Field label="Headline" hint="A short hook — used wherever you choose to show the headline instead of the full blurb.">
          <FormattedTextarea
            value={draft.headline}
            onChange={(v) => set('headline', v)}
            rows={2}
            placeholder="One irresistible line about the book."
          />
        </Field>

        <Field label="Description">
          <FormattedTextarea
            value={draft.description}
            onChange={(v) => set('description', v)}
            rows={4}
            placeholder="The full blurb for the book."
          />
        </Field>

        <Field label="What to show on this page" hint="Choose which text appears next to the cover.">
          <select
            value={draft.pageTextMode}
            onChange={(e) => set('pageTextMode', e.target.value as BookTextMode)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="description">Full description</option>
            <option value="headline">Headline only</option>
            <option value="custom">Custom text</option>
            <option value="none">No text</option>
          </select>
          {draft.pageTextMode === 'custom' && (
            <div className="mt-2">
              <FormattedTextarea
                value={draft.pageTextCustom}
                onChange={(v) => set('pageTextCustom', v)}
                rows={3}
                placeholder="Custom text for this page."
              />
            </div>
          )}
        </Field>

        <Field label="Cover image" hint="Upload a full-resolution cover for a crisp page. (Auto-fetched covers can be low-res.)">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer">
                {coverBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {draft.coverUrl ? 'Replace cover' : 'Upload cover'}
                <input type="file" accept="image/*" className="hidden" disabled={coverBusy} onChange={handleCoverUpload} />
              </label>
              <input
                value={draft.coverUrl}
                onChange={(e) => set('coverUrl', e.target.value)}
                placeholder="…or paste an image URL"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            {draft.coverUrl.trim() && (
              <img src={draft.coverUrl} alt="" className="w-16 h-24 object-cover rounded border border-slate-200 bg-slate-100 shrink-0" />
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
            <p className="text-xs text-slate-400">No buttons yet. Add one per store (Amazon, Apple Books, Kobo…).</p>
          ) : (
            <div className="space-y-2">
              {draft.buttons.map((b, i) => {
                const isKnown = KNOWN_RETAILERS.includes(b.label);
                const selectVal = isKnown ? b.label : (b.label || customRows[i] ? '__other__' : '');
                return (
                  <div key={i} className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />
                    <select
                      value={selectVal}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__other__') {
                          setCustomRows((m) => ({ ...m, [i]: true }));
                          updateButton(i, { label: '' });
                        } else {
                          setCustomRows((m) => ({ ...m, [i]: false }));
                          updateButton(i, { label: v });
                        }
                      }}
                      className="w-40 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    >
                      <option value="">Choose retailer…</option>
                      {KNOWN_RETAILERS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      <option value="__other__">Other…</option>
                    </select>
                    {selectVal === '__other__' && (
                      <input
                        value={b.label}
                        onChange={(e) => updateButton(i, { label: e.target.value })}
                        placeholder="Name"
                        className="w-28 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    )}
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
                );
              })}
            </div>
          )}
        </div>

        {/* Sample link */}
        <Field label="Sample link" hint="Paste a link to a sample or first chapter (BookFunnel, Prolific Works, your own PDF…). Shows below the retailers.">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2">
            <input
              value={draft.sampleUrl}
              onChange={(e) => set('sampleUrl', e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              value={draft.sampleLabel}
              onChange={(e) => set('sampleLabel', e.target.value)}
              placeholder="Read a sample"
              disabled={!draft.sampleUrl.trim()}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
        </Field>

        {/* Reviews */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-slate-700">Reviews</label>
            <button onClick={addReview} className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add review
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-2">Reader quotes shown below the blurb as social proof. Star rating, quote, and who said it.</p>
          {draft.reviews.length === 0 ? (
            <p className="text-xs text-slate-400">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {draft.reviews.map((r, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => updateReview(i, { stars: n })}
                          className="p-0.5"
                          aria-label={`${n} star${n === 1 ? '' : 's'}`}
                        >
                          <Star
                            className={`w-5 h-5 ${n <= r.stars ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`}
                          />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => removeReview(i)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                      title="Remove review"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <FormattedTextarea
                    value={r.quote}
                    onChange={(v) => updateReview(i, { quote: v })}
                    rows={3}
                    placeholder="What the reviewer said about the book."
                  />
                  <input
                    value={r.attribution}
                    onChange={(e) => updateReview(i, { attribution: e.target.value })}
                    placeholder="Who said it (e.g. Goodreads, Sarah K., Publishers Weekly)"
                    className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cross-sell: other books from a series */}
        <Field
          label="Other books to show"
          hint="Pulls covers from one of your series pages and shows them below the retailer buttons. The current book is automatically left out."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={draft.seriesPageId ?? ''}
              onChange={(e) => set('seriesPageId', e.target.value || null)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Don't show other books</option>
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.title?.trim() || `/${s.slug}`}</option>
              ))}
            </select>
            <select
              value={draft.crossSellLabel}
              onChange={(e) => set('crossSellLabel', e.target.value as CrossSellLabel)}
              disabled={!draft.seriesPageId}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="series">Read the complete series</option>
              <option value="world">More standalones in this world</option>
              <option value="more">More books like this</option>
              <option value="none">Hide section</option>
            </select>
          </div>
          {seriesOptions.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">No series pages yet — create one in Series pages to use this.</p>
          )}
        </Field>

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
