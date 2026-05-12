import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Book, BookInsert, BookStatus } from '../types';
import { STATUS_LABELS } from '../types';

interface BookFormProps {
  initial?: Book | null;
  onSubmit: (input: BookInsert) => Promise<void> | void;
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
    await onSubmit({
      ...draft,
      tropes: linesToArray(tropesText),
      amazon_keywords: linesToArray(amazonKwText),
      keywords: linesToArray(keywordsText),
      bisac_categories: linesToArray(bisacText),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
          <label className={labelCls}>Tropes <span className="text-slate-400 font-normal">(one per line)</span></label>
          <textarea rows={5} className={inputCls} value={tropesText} onChange={e => setTropesText(e.target.value)} placeholder={'Curvy Girl\nFated Mates\nHe falls first'} />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Amazon keywords <span className="text-slate-400 font-normal">(one per line, 7 max)</span></label>
            <textarea rows={7} className={inputCls} value={amazonKwText} onChange={e => setAmazonKwText(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Other keywords <span className="text-slate-400 font-normal">(one per line)</span></label>
            <textarea rows={7} className={inputCls} value={keywordsText} onChange={e => setKeywordsText(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>BISAC categories <span className="text-slate-400 font-normal">(one per line)</span></label>
            <textarea rows={7} className={inputCls} value={bisacText} onChange={e => setBisacText(e.target.value)} />
          </div>
        </div>
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
