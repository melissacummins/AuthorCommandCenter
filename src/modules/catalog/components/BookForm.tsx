import { useRef, useState, type FormEvent } from 'react';
import { BookOpen, Plus, Star, Trash2, Upload, X } from 'lucide-react';
import type { Book, BookInsert, BookStatus, ReviewExcerpt } from '../types';
import { STATUS_LABELS } from '../types';

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

const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-white';
const sectionCls = 'bg-white rounded-2xl border border-slate-200 p-5 space-y-4';
const sectionTitle = 'text-sm font-semibold text-slate-800 uppercase tracking-wide';

export default function BookForm({ initial, onSubmit, onCancel, onDelete, saving }: BookFormProps) {
  const [draft, setDraft] = useState<BookInsert>(initial ? fromBook(initial) : emptyDraft());
  const [tropesText, setTropesText] = useState((initial?.tropes ?? []).join('\n'));
  const [amazonKwText, setAmazonKwText] = useState((initial?.amazon_keywords ?? []).join('\n'));
  const [keywordsText, setKeywordsText] = useState((initial?.keywords ?? []).join('\n'));
  const [bisacText, setBisacText] = useState((initial?.bisac_categories ?? []).join('\n'));
  const [reviews, setReviews] = useState<ReviewExcerpt[]>(initial?.reviews ?? []);

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

      {/* Discovery */}
      <div className={sectionCls}>
        <h3 className={sectionTitle}>Discovery</h3>
        <p className="text-xs text-slate-500 -mt-2">One entry per line.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
