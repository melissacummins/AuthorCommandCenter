import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Copy, ExternalLink, Plus, Star, Trash2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { usePenNames } from '../../../contexts/PenNameContext';
import { penNameClasses } from '../../../components/PenNameChip';
import { fetchKdpDataForCatalogBook } from '../../kdp-optimizer/api';
import type { KdpBook, Keyword } from '../../kdp-optimizer/types';
import { getMetadataWords, optimizeKeywords } from '../../kdp-optimizer/utils';
import type { Book, BookInsert, BookStatus, BookWordLog, ReviewExcerpt } from '../types';
import { STATUS_LABELS, TRANSLATION_LANGUAGES, languageLabel, detectTranslationSuffix } from '../types';
import { listBooks, listWordLogs, bookTrackedMinutes } from '../api';
import { getManuscriptForBook } from '../../writing/api';
import { STATUS_LABELS as MANUSCRIPT_STATUS_LABELS, STATUS_COLORS as MANUSCRIPT_STATUS_COLORS } from '../../writing/types';
import type { Manuscript } from '../../writing/types';
import { Languages, Link2, Clock, PenTool } from 'lucide-react';

interface BookFormProps {
  initial?: Book | null;
  onSubmit: (input: BookInsert, coverFile: File | null, coverCleared: boolean) => Promise<void> | void;
  onCancel: () => void;
  onDelete?: () => Promise<void> | void;
  saving?: boolean;
}

function emptyDraft(): BookInsert {
  return {
    title: '',
    subtitle: null,
    series: null,
    series_position: null,
    language: null,
    parent_book_id: null,
    pen_name_id: null,
    status: 'idea',
    publish_date: null,
    pre_order_date: null,
    manuscript_due_date: null,
    ebook_price: null,
    paperback_price: null,
    hardcover_price: null,
    audiobook_price: null,
    blurb: null,
    content_warnings: null,
    kinks: null,
    tropes: [],
    page_count: null,
    word_count: null,
    target_word_count: null,
    current_chapter: null,
    asin: null,
    isbn_ebook: null,
    isbn_paperback: null,
    isbn_audiobook: null,
    isbn_hardcover: null,
    amazon_keywords: [],
    keywords: [],
    bisac_categories: [],
    reviews: [],
    cover_url: null,
    notes: null,
    include_in_arcs: true,
  };
}

function fromBook(b: Book): BookInsert {
  const { id: _id, user_id: _u, created_at: _c, updated_at: _up, ...rest } = b;
  return rest;
}

const STATUSES: BookStatus[] = ['idea', 'drafting', 'editing', 'pre_order', 'published', 'paused'];

// Split textarea content into a string[] on newlines (or commas if no newlines).
function linesToArray(value: string): string[] {
  if (!value.trim()) return [];
  const sep = value.includes('\n') ? '\n' : ',';
  return value
    .split(sep)
    .map(s => s.trim())
    .filter(Boolean);
}

// "3h 30m" / "45m" / "2h" from minutes; "0m" when empty.
function formatHm(mins: number): string {
  if (!mins || mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Short "Jun 8" label for a YYYY-MM-DD log day.
function logDayLabel(day: string): string {
  return new Date(day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-white';
const sectionCls = 'bg-white rounded-2xl border border-slate-200 p-5 space-y-4';
const sectionTitle = 'text-sm font-semibold text-slate-800 uppercase tracking-wide';

export default function BookForm({ initial, onSubmit, onCancel, onDelete, saving }: BookFormProps) {
  const { user } = useAuth();
  const { penNames, selectedPenNameId } = usePenNames();
  // New books default to the currently-selected pen name from the header
  // so the picker acts as a "working pen name" the user doesn't have to
  // reselect for every new entry.
  const [draft, setDraft] = useState<BookInsert>(() => {
    if (initial) return fromBook(initial);
    const d = emptyDraft();
    if (selectedPenNameId) d.pen_name_id = selectedPenNameId;
    return d;
  });
  const [tropesText, setTropesText] = useState((initial?.tropes ?? []).join('\n'));
  const [amazonKwText, setAmazonKwText] = useState((initial?.amazon_keywords ?? []).join('\n'));
  const [keywordsText, setKeywordsText] = useState((initial?.keywords ?? []).join('\n'));
  const [bisacText, setBisacText] = useState((initial?.bisac_categories ?? []).join('\n'));
  const [reviews, setReviews] = useState<ReviewExcerpt[]>(initial?.reviews ?? []);

  // KDP data for the linked book. Loaded once when editing an existing
  // catalog book; lets us surface the keywords selected in KDP
  // Optimizer without forcing duplicate data entry here.
  const [kdpData, setKdpData] = useState<{ kdpBook: KdpBook; keywords: Keyword[] } | null>(null);
  useEffect(() => {
    if (!user || !initial?.id) return;
    let cancelled = false;
    fetchKdpDataForCatalogBook(user.id, initial.id)
      .then(d => { if (!cancelled) setKdpData(d); })
      .catch(() => { /* surfacing the link is best-effort */ });
    return () => { cancelled = true; };
  }, [user, initial?.id]);

  // Progress history for this book: dated word-count snapshots (charted in
  // Production & progress) and the hours tracked against it via linked planner
  // lists. Best-effort, loaded once when editing an existing book.
  const [wordLogs, setWordLogs] = useState<BookWordLog[]>([]);
  const [trackedMinutes, setTrackedMinutes] = useState(0);
  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    listWordLogs(initial.id)
      .then(rows => { if (!cancelled) setWordLogs(rows); })
      .catch(() => { /* best-effort — the form still works without history */ });
    bookTrackedMinutes(initial.id)
      .then(mins => { if (!cancelled) setTrackedMinutes(mins); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [initial?.id]);

  // Read-only linked-manuscript chip (Writing directive §8.3 — the one
  // permitted Catalog edit outside the writing module + settings). Best-effort:
  // Writing's own module already owns editing this link.
  const [linkedManuscript, setLinkedManuscript] = useState<Manuscript | null>(null);
  useEffect(() => {
    if (!user || !initial?.id) return;
    let cancelled = false;
    getManuscriptForBook(user.id, initial.id)
      .then(m => { if (!cancelled) setLinkedManuscript(m); })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [user, initial?.id]);

  // Catalog books — used to populate the 'Translation of' picker and
  // to auto-suggest a parent based on the current book's title suffix.
  // Fetched on mount; the list only changes when the user creates
  // books elsewhere, which is rare enough during a form edit that we
  // don't refresh on every parent_book_id change.
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listBooks(user.id)
      .then(rows => { if (!cancelled) setCatalogBooks(rows); })
      .catch(() => { /* best-effort — the manual picker still works without the auto-suggest */ });
    return () => { cancelled = true; };
  }, [user]);

  // Auto-suggest a translation parent: if the current title looks
  // like "Original - GE" / "Original - FR" / etc. AND there's a
  // matching original in the catalog AND we don't already have a
  // parent set, surface a one-click link banner.
  const translationSuggestion = useMemo(() => {
    if (draft.parent_book_id) return null;
    const suffix = detectTranslationSuffix(draft.title);
    if (!suffix) return null;
    const parent = catalogBooks.find(
      b => b.id !== initial?.id
        && b.parent_book_id === null
        && b.title.trim().toLowerCase() === suffix.baseTitle.toLowerCase(),
    );
    if (!parent) return null;
    return { parent, languageCode: suffix.languageCode };
  }, [catalogBooks, draft.title, draft.parent_book_id, initial?.id]);

  const parentBook = draft.parent_book_id
    ? catalogBooks.find(b => b.id === draft.parent_book_id) ?? null
    : null;

  const kdpBoxes = useMemo(() => {
    if (!kdpData || kdpData.keywords.length === 0) return [];
    const kdp = kdpData.kdpBook;
    // Use the catalog book's metadata as the source of truth — that's
    // what's going to ship on the listing.
    const meta = getMetadataWords({
      title: draft.title,
      subtitle: draft.subtitle,
      series: draft.series,
      amazon_categories: kdp.amazon_categories,
    });
    return optimizeKeywords(kdpData.keywords.map(k => k.text), meta);
  }, [kdpData, draft.title, draft.subtitle, draft.series]);

  const totalKdpVolume = kdpData?.keywords.reduce((s, k) => s + (k.search_volume || 0), 0) ?? 0;

  function addReview() {
    setReviews(r => [...r, { quote: '', source: '', rating: null }]);
  }
  function updateReview(i: number, patch: Partial<ReviewExcerpt>) {
    setReviews(r => r.map((rev, idx) => (idx === i ? { ...rev, ...patch } : rev)));
  }
  function removeReview(i: number) {
    setReviews(r => r.filter((_, idx) => idx !== i));
  }

  // Cover state: pendingFile holds a not-yet-uploaded file; previewUrl shows
  // either the local blob preview or the saved cover_url. coverCleared
  // tracks whether the user explicitly removed an existing cover.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initial?.cover_url ?? null);
  const [coverCleared, setCoverCleared] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickCover(file: File | null) {
    if (!file) return;
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCoverCleared(false);
  }

  function clearCover() {
    setPendingFile(null);
    setPreviewUrl(null);
    setCoverCleared(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function set<K extends keyof BookInsert>(key: K, value: BookInsert[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  function setNum(key: keyof BookInsert, raw: string) {
    const v = raw.trim() === '' ? null : Number(raw);
    set(key, (Number.isFinite(v as number) ? v : null) as never);
  }

  function setText(key: keyof BookInsert, raw: string) {
    set(key, (raw === '' ? null : raw) as never);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    await onSubmit(
      {
        ...draft,
        tropes: linesToArray(tropesText),
        amazon_keywords: linesToArray(amazonKwText),
        keywords: linesToArray(keywordsText),
        bisac_categories: linesToArray(bisacText),
        reviews: reviews
          .map(r => ({ quote: r.quote.trim(), source: r.source.trim(), rating: r.rating ?? null }))
          .filter(r => r.quote || r.source),
      },
      pendingFile,
      coverCleared,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Cover */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Cover</h3>
        <div className="flex items-start gap-4">
          <div className="w-28 h-40 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
            {previewUrl ? (
              <img src={previewUrl} alt="Cover preview" className="w-full h-full object-cover" />
            ) : (
              <BookOpen className="w-8 h-8 text-indigo-400" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={e => pickCover(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                <Upload className="w-4 h-4" />
                {previewUrl ? 'Replace cover' : 'Upload cover'}
              </button>
              {previewUrl && (
                <button
                  type="button"
                  onClick={clearCover}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg"
                >
                  <X className="w-4 h-4" /> Remove
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              PNG, JPG, WebP, or GIF. Up to 10MB. Saved when you save the book.
            </p>
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Identity</h3>
        <div>
          <label className={labelCls}>Title *</label>
          <input
            className={inputCls}
            value={draft.title}
            onChange={e => set('title', e.target.value)}
            required
            placeholder="My Vicious Beast"
          />
        </div>
        <div>
          <label className={labelCls}>Subtitle</label>
          <input
            className={inputCls}
            value={draft.subtitle ?? ''}
            onChange={e => setText('subtitle', e.target.value)}
            placeholder="A Dark Monster Romance, Beauty & The Beast Retelling"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>Series</label>
            <input
              className={inputCls}
              value={draft.series ?? ''}
              onChange={e => setText('series', e.target.value)}
              placeholder="Claimed by Beasts"
            />
          </div>
          <div>
            <label className={labelCls}>Position in series</label>
            <input
              type="number"
              min={1}
              className={inputCls}
              value={draft.series_position ?? ''}
              onChange={e => setNum('series_position', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Pen name</label>
          {penNames.length === 0 ? (
            <p className="text-xs text-slate-500">
              No pen names yet — add one in <a href="/settings" className="text-indigo-600 hover:underline">Settings</a>.
            </p>
          ) : (
            <select
              className={inputCls}
              value={draft.pen_name_id ?? ''}
              onChange={e => set('pen_name_id', e.target.value || null)}
            >
              <option value="">— Unassigned —</option>
              {penNames.map(pn => (
                <option key={pn.id} value={pn.id}>{pn.name}</option>
              ))}
            </select>
          )}
          {draft.pen_name_id && (
            <div className="mt-1">
              {(() => {
                const pn = penNames.find(p => p.id === draft.pen_name_id);
                if (!pn) return null;
                const c = penNameClasses(pn.color);
                return <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}><span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{pn.name}</span>;
              })()}
            </div>
          )}
        </div>

        {/* Translation hierarchy. A book can be a translation of
            another Catalog book; we offer a one-click suggestion when
            the title has a recognized suffix like "- GE" / "- FR" and
            a matching original exists in the catalog. */}
        <div>
          <label className={labelCls}>
            <Languages className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Translation of (optional)
          </label>

          {translationSuggestion && (
            <div className="mb-2 flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-xs text-indigo-800">
              <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                Looks like a {languageLabel(translationSuggestion.languageCode)} translation of{' '}
                <strong>{translationSuggestion.parent.title}</strong>.
              </div>
              <button
                type="button"
                onClick={() => setDraft(d => ({
                  ...d,
                  parent_book_id: translationSuggestion.parent.id,
                  language: translationSuggestion.languageCode,
                }))}
                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                Link it
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select
              className={inputCls}
              value={draft.parent_book_id ?? ''}
              onChange={e => set('parent_book_id', e.target.value || null)}
            >
              <option value="">— Not a translation —</option>
              {catalogBooks
                .filter(b => b.id !== initial?.id && b.parent_book_id === null)
                .map(b => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
            </select>
            <select
              className={inputCls}
              value={draft.language ?? ''}
              onChange={e => set('language', e.target.value || null)}
              disabled={!draft.parent_book_id}
            >
              <option value="">— Language —</option>
              {TRANSLATION_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          {parentBook && (
            <p className="text-xs text-slate-500 mt-1.5">
              {languageLabel(draft.language) ?? 'Language not set'} translation of{' '}
              <strong className="text-slate-700">{parentBook.title}</strong>
            </p>
          )}
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={draft.include_in_arcs !== false}
              onChange={e => set('include_in_arcs', e.target.checked)}
            />
            Show this book in the ARC applicant picker
          </label>
        </div>

        <div>
          <label className={labelCls}>Status</label>
          <select
            className={inputCls}
            value={draft.status}
            onChange={e => set('status', e.target.value as BookStatus)}
          >
            {STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Dates */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Dates</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Publish date</label>
            <input type="date" className={inputCls} value={draft.publish_date ?? ''} onChange={e => setText('publish_date', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Pre-order date</label>
            <input type="date" className={inputCls} value={draft.pre_order_date ?? ''} onChange={e => setText('pre_order_date', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Manuscript due</label>
            <input type="date" className={inputCls} value={draft.manuscript_due_date ?? ''} onChange={e => setText('manuscript_due_date', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Pricing</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>eBook</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={draft.ebook_price ?? ''} onChange={e => setNum('ebook_price', e.target.value)} placeholder="7.99" />
          </div>
          <div>
            <label className={labelCls}>Paperback</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={draft.paperback_price ?? ''} onChange={e => setNum('paperback_price', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Hardcover</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={draft.hardcover_price ?? ''} onChange={e => setNum('hardcover_price', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Audiobook</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={draft.audiobook_price ?? ''} onChange={e => setNum('audiobook_price', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Blurb & warnings */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Marketing copy</h3>
        <div>
          <label className={labelCls}>Blurb</label>
          <textarea rows={8} className={inputCls} value={draft.blurb ?? ''} onChange={e => setText('blurb', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Content &amp; trigger warnings</label>
          <textarea rows={5} className={inputCls} value={draft.content_warnings ?? ''} onChange={e => setText('content_warnings', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Kinks / spice notes</label>
          <textarea rows={3} className={inputCls} value={draft.kinks ?? ''} onChange={e => setText('kinks', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Tropes</label>
          <textarea
            rows={5}
            className={inputCls}
            value={tropesText}
            onChange={e => setTropesText(e.target.value)}
            placeholder={'One per line:\nCurvy Girl\nFated Mates\nHe falls first'}
          />
        </div>
      </div>

      {/* Production / progress */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Production &amp; progress</h3>

        {linkedManuscript && (
          <div className="flex items-center gap-2 text-sm">
            <PenTool className="w-4 h-4 text-lime-500 shrink-0" />
            <span className="text-slate-600">Linked manuscript:</span>
            <span className="font-medium text-slate-800">{linkedManuscript.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${MANUSCRIPT_STATUS_COLORS[linkedManuscript.status]}`}>
              {MANUSCRIPT_STATUS_LABELS[linkedManuscript.status]}
            </span>
            <span className="text-xs text-slate-400">{linkedManuscript.word_count.toLocaleString()} words</span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={labelCls}>Page count</label>
            <input type="number" min={0} className={inputCls} value={draft.page_count ?? ''} onChange={e => setNum('page_count', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Word count</label>
            <input type="number" min={0} className={inputCls} value={draft.word_count ?? ''} onChange={e => setNum('word_count', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Target words</label>
            <input type="number" min={0} className={inputCls} value={draft.target_word_count ?? ''} onChange={e => setNum('target_word_count', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Current chapter</label>
            <input className={inputCls} value={draft.current_chapter ?? ''} onChange={e => setText('current_chapter', e.target.value)} />
          </div>
        </div>

        {/* Hours worked — rolled up from any planner lists linked to this book. */}
        {trackedMinutes > 0 && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Clock className="w-4 h-4 text-teal-500 shrink-0" />
            <span className="font-semibold">{formatHm(trackedMinutes)}</span>
            <span className="text-slate-400 text-xs">worked — tracked via linked planner lists</span>
          </div>
        )}

        {/* Word-count history — a snapshot is auto-recorded each time you save. */}
        {wordLogs.length > 0 && (() => {
          const max = Math.max(...wordLogs.map(l => l.word_count), 1);
          const first = wordLogs[0];
          const last = wordLogs[wordLogs.length - 1];
          const gained = last.word_count - first.word_count;
          return (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Word-count history</span>
                <span className="text-xs text-slate-400">
                  {wordLogs.length} {wordLogs.length === 1 ? 'entry' : 'entries'}
                  {wordLogs.length > 1 && gained !== 0 && (
                    <span className={gained > 0 ? 'text-emerald-600 ml-1' : 'text-rose-600 ml-1'}>
                      ({gained > 0 ? '+' : ''}{gained.toLocaleString()})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-end gap-1 h-16">
                {wordLogs.map(l => (
                  <div
                    key={l.id}
                    className="flex-1 flex flex-col justify-end"
                    title={`${logDayLabel(l.day)} · ${l.word_count.toLocaleString()} words`}
                  >
                    <div
                      className="w-full rounded-t bg-indigo-400 hover:bg-indigo-500 transition-colors"
                      style={{ height: `${Math.max(4, (l.word_count / max) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                <span>{logDayLabel(first.day)}</span>
                {wordLogs.length > 1 && <span>{logDayLabel(last.day)}</span>}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                A snapshot is recorded automatically each time you save this book.
              </p>
            </div>
          );
        })()}
      </div>

      {/* Identifiers */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Identifiers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>ASIN</label>
            <input className={inputCls} value={draft.asin ?? ''} onChange={e => setText('asin', e.target.value)} placeholder="B0GHZK9S8G" />
          </div>
          <div>
            <label className={labelCls}>ISBN — eBook</label>
            <input className={inputCls} value={draft.isbn_ebook ?? ''} onChange={e => setText('isbn_ebook', e.target.value)} placeholder="9781958769195" />
          </div>
          <div>
            <label className={labelCls}>ISBN — Paperback</label>
            <input className={inputCls} value={draft.isbn_paperback ?? ''} onChange={e => setText('isbn_paperback', e.target.value)} placeholder="9781958769416" />
          </div>
          <div>
            <label className={labelCls}>ISBN — Hardcover</label>
            <input className={inputCls} value={draft.isbn_hardcover ?? ''} onChange={e => setText('isbn_hardcover', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>ISBN — Audiobook</label>
            <input className={inputCls} value={draft.isbn_audiobook ?? ''} onChange={e => setText('isbn_audiobook', e.target.value)} />
          </div>
        </div>
      </div>

      {/* KDP Optimizer keywords (only when linked & has selections) */}
      {kdpData && kdpData.keywords.length > 0 && (
        <div className={sectionCls}>
          <div className="flex items-center justify-between gap-3">
            <h3 className={sectionTitle}>Amazon keywords (from KDP Optimizer)</h3>
            <Link
              to="/kdp-optimizer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open KDP Optimizer
            </Link>
          </div>
          <p className="text-xs text-slate-500 -mt-2">
            Pulled from the linked KDP book — manage selections in KDP Optimizer. The boxes below
            are computed from your selected keywords with words from this book's title, subtitle,
            and series filtered out.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Amazon keyword boxes ({Math.min(kdpBoxes.length, 7)}/7)
              </h4>
              {Array.from({ length: 7 }).map((_, i) => (
                <KdpBoxRow key={i} index={i + 1} content={kdpBoxes[i] ?? ''} />
              ))}
              {kdpBoxes.length > 7 && (
                <p className="text-xs text-rose-600">
                  {kdpBoxes.length - 7} extra word group{kdpBoxes.length - 7 === 1 ? '' : 's'}{' '}
                  couldn't fit in the 7 boxes. Trim selections in KDP Optimizer to fit.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Selected phrases
              </h4>
              <div className="text-2xl font-bold text-slate-800">{kdpData.keywords.length}</div>
              <div className="text-xs text-slate-500">
                Total search volume: <span className="font-semibold text-slate-700">{totalKdpVolume.toLocaleString()}</span>
              </div>
              <div className="max-h-48 overflow-auto border border-slate-100 rounded-lg bg-slate-50">
                {kdpData.keywords
                  .slice()
                  .sort((a, b) => b.search_volume - a.search_volume)
                  .slice(0, 25)
                  .map(k => (
                    <div key={k.id} className="px-2 py-1 text-xs text-slate-700 truncate">
                      {k.text}
                    </div>
                  ))}
                {kdpData.keywords.length > 25 && (
                  <div className="px-2 py-1 text-xs text-slate-400">
                    + {kdpData.keywords.length - 25} more
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discovery */}
      {(() => {
        const kdpLinked = Boolean(kdpData && kdpData.keywords.length > 0);
        const gridCols = kdpLinked ? 'md:grid-cols-2' : 'md:grid-cols-3';
        return (
          <div className={sectionCls}>
            <h3 className={sectionTitle}>Discovery</h3>
            <p className="text-xs text-slate-500 -mt-2">One entry per line.</p>
            <div className={`grid grid-cols-1 ${gridCols} gap-3`}>
              {!kdpLinked && (
                <div>
                  <label className={labelCls}>Amazon keywords</label>
                  <textarea
                    rows={7}
                    className={inputCls}
                    value={amazonKwText}
                    onChange={e => setAmazonKwText(e.target.value)}
                    placeholder="7 keywords max"
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>Other keywords</label>
                <textarea
                  rows={7}
                  className={inputCls}
                  value={keywordsText}
                  onChange={e => setKeywordsText(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>BISAC categories</label>
                <textarea
                  rows={7}
                  className={inputCls}
                  value={bisacText}
                  onChange={e => setBisacText(e.target.value)}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Reviews */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between">
          <h3 className={sectionTitle}>Review excerpts</h3>
          <button
            type="button"
            onClick={addReview}
            className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          >
            <Plus className="w-4 h-4" /> Add review
          </button>
        </div>
        {reviews.length === 0 ? (
          <p className="text-xs text-slate-500">
            Pull-quotes you want to reuse on covers, ads, or your bio page.
          </p>
        ) : (
          <div className="space-y-3">
            {reviews.map((rev, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/50">
                <textarea
                  rows={2}
                  className={inputCls}
                  value={rev.quote}
                  onChange={e => updateReview(i, { quote: e.target.value })}
                  placeholder="“Devoured this in one sitting.”"
                />
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    className={`${inputCls} flex-1 min-w-[8rem]`}
                    value={rev.source}
                    onChange={e => updateReview(i, { source: e.target.value })}
                    placeholder="Source (reader, blog, Goodreads…)"
                  />
                  <StarPicker
                    value={rev.rating ?? null}
                    onChange={r => updateReview(i, { rating: r })}
                  />
                  <button
                    type="button"
                    onClick={() => removeReview(i)}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded"
                    aria-label="Remove review"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Notes</h3>
        <textarea rows={4} className={inputCls} value={draft.notes ?? ''} onChange={e => setText('notes', e.target.value)} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div>
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirm('Delete this book? This cannot be undone.')) onDelete();
              }}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.title.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
          >
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add book'}
          </button>
        </div>
      </div>
    </form>
  );
}

function KdpBoxRow({ index, content }: { index: number; content: string }) {
  const [copied, setCopied] = useState(false);
  const isEmpty = content.length === 0;
  function copy() {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 w-12 shrink-0">
        Box {index}
      </span>
      <input
        readOnly
        value={content}
        placeholder="Empty"
        className={`flex-1 px-3 py-1.5 rounded-md font-mono text-xs border ${
          isEmpty ? 'bg-slate-50 border-slate-200' : 'bg-white border-indigo-200'
        }`}
      />
      <span className="text-[10px] font-mono text-slate-400 w-12 text-right">
        {content.length}/50
      </span>
      <button
        type="button"
        onClick={copy}
        disabled={isEmpty}
        title="Copy"
        className="p-1.5 text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400"
      >
        {copied ? <span className="text-[10px] text-emerald-600">Copied</span> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function StarPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => {
        const active = value !== null && value >= n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? null : n)}
            className="p-0.5"
            aria-label={`${n} star`}
            aria-checked={value === n}
            role="radio"
          >
            <Star className={`w-4 h-4 ${active ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
          </button>
        );
      })}
    </div>
  );
}
