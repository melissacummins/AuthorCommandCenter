import { useMemo, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Book } from '../../catalog/types';
import type { ArcReader, ArcReaderInsert, ArcStatus, ReaderBookRelationship, UnmatchedTitles } from '../types';
import { impliedFunnelStatusFromReader, isFunnelStatus, PLACES, STATUS_LABELS, STATUS_ORDER } from '../types';
import ReaderBookSection from './ReaderBookSection';

// Submit shape: basic reader fields + the desired final state of each
// book-history bucket as book_ids. The parent diffs against the
// existing junction and writes through the API helpers.
export interface ReaderFormSubmit {
  reader: ArcReaderInsert;
  bookHistory: {
    applied: string[];
    received: string[];
    reviewed: string[];
  };
}

interface Props {
  initial: ArcReader | null;
  catalogBooks: Book[];
  saving?: boolean;
  onSubmit: (input: ReaderFormSubmit) => Promise<void> | void;
  onCancel: () => void;
  onDelete?: () => Promise<void> | void;
  onDismissUnmatched?: (title: string, relationship: ReaderBookRelationship) => Promise<void> | void;
}

const labelCls = 'block text-xs font-medium text-slate-700 mb-1';
const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none bg-white';
const sectionCls = 'bg-white rounded-2xl border border-slate-200 p-5 space-y-4';

// Project an ArcReader down to the insert shape. The joined
// `reader_books` rows and the backfill `unmatched_titles` JSONB are
// derived state — they must NOT round-trip back into an UPDATE on
// arc_readers (no such columns exist there). updateArcReader also
// sanitizes defensively, but stripping here keeps form-local state
// honest with the type signature.
function fromReader(r: ArcReader): ArcReaderInsert {
  const {
    id: _id, user_id: _u, created_at: _c, updated_at: _up,
    reader_books: _rb, unmatched_titles: _ut,
    ...rest
  } = r;
  return rest;
}

function emptyDraft(): ArcReaderInsert {
  return {
    name: '',
    email: null,
    primary_sm: null,
    ig_profile_url: null,
    tt_profile_url: null,
    threads_profile_url: null,
    fb_profile_url: null,
    goodreads_profile_url: null,
    amazon_reviewer_url: null,
    blog_url: null,
    status: 'new',
    applied_for: [],
    received: [],
    reviewed: [],
    place_to_review: [],
    newsletter_subscribed: false,
    promo_team: false,
    notes: null,
    external_id: null,
  };
}

export default function ReaderForm({ initial, catalogBooks, saving, onSubmit, onCancel, onDelete, onDismissUnmatched }: Props) {
  const [draft, setDraft] = useState<ArcReaderInsert>(initial ? fromReader(initial) : emptyDraft());

  // Form-local copy of the junction split by relationship. Initialized
  // from the joined reader_books on edit, empty on create. On submit
  // the parent diffs against `initial?.reader_books` to compute the
  // add/remove calls.
  const [appliedIds, setAppliedIds] = useState<string[]>(
    () => (initial?.reader_books ?? []).filter(rb => rb.relationship === 'applied').map(rb => rb.book_id),
  );
  const [receivedIds, setReceivedIds] = useState<string[]>(
    () => (initial?.reader_books ?? []).filter(rb => rb.relationship === 'received').map(rb => rb.book_id),
  );
  const [reviewedIds, setReviewedIds] = useState<string[]>(
    () => (initial?.reader_books ?? []).filter(rb => rb.relationship === 'reviewed').map(rb => rb.book_id),
  );

  const unmatched: UnmatchedTitles = initial?.unmatched_titles ?? {};

  function setText(key: keyof ArcReaderInsert, raw: string) {
    setDraft(d => ({ ...d, [key]: raw === '' ? null : raw }));
  }

  // Auto-flip the funnel status when the form's book-history counts
  // imply a different funnel state — same behavior the previous
  // toggleArr had, but derived from junction-local state.
  const impliedStatus = useMemo(() => {
    if (!isFunnelStatus(draft.status)) return draft.status;
    return impliedFunnelStatusFromReader({
      ...(initial ?? ({} as ArcReader)),
      status: draft.status,
      reader_books: [
        ...appliedIds.map(id => ({ id: '', reader_id: '', book_id: id, relationship: 'applied' as const, recorded_at: '', book_title: '', pen_name_id: null })),
        ...receivedIds.map(id => ({ id: '', reader_id: '', book_id: id, relationship: 'received' as const, recorded_at: '', book_title: '', pen_name_id: null })),
        ...reviewedIds.map(id => ({ id: '', reader_id: '', book_id: id, relationship: 'reviewed' as const, recorded_at: '', book_title: '', pen_name_id: null })),
      ],
    });
  }, [draft.status, appliedIds, receivedIds, reviewedIds, initial]);

  // When the implied status changes and the user hasn't manually
  // picked a non-funnel status, surface it via the status dropdown.
  if (isFunnelStatus(draft.status) && impliedStatus !== draft.status) {
    setDraft(d => ({ ...d, status: impliedStatus }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    await onSubmit({
      reader: draft,
      bookHistory: { applied: appliedIds, received: receivedIds, reviewed: reviewedIds },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Identity */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Name *</label>
            <input
              className={inputCls}
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} type="email" value={draft.email ?? ''} onChange={e => setText('email', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as ArcStatus }))}>
              {STATUS_ORDER.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Primary social</label>
            <input className={inputCls} value={draft.primary_sm ?? ''} onChange={e => setText('primary_sm', e.target.value)} placeholder="Instagram, TikTok, etc." />
          </div>
        </div>
      </div>

      {/* Profiles */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Instagram URL</label>
            <input className={inputCls} value={draft.ig_profile_url ?? ''} onChange={e => setText('ig_profile_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>TikTok URL</label>
            <input className={inputCls} value={draft.tt_profile_url ?? ''} onChange={e => setText('tt_profile_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Threads URL</label>
            <input className={inputCls} value={draft.threads_profile_url ?? ''} onChange={e => setText('threads_profile_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Facebook URL</label>
            <input className={inputCls} value={draft.fb_profile_url ?? ''} onChange={e => setText('fb_profile_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Goodreads URL</label>
            <input className={inputCls} value={draft.goodreads_profile_url ?? ''} onChange={e => setText('goodreads_profile_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Amazon reviewer URL</label>
            <input className={inputCls} value={draft.amazon_reviewer_url ?? ''} onChange={e => setText('amazon_reviewer_url', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Blog URL</label>
            <input className={inputCls} value={draft.blog_url ?? ''} onChange={e => setText('blog_url', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Per-book history */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Per-book history</h3>
        <p className="text-xs text-slate-500 -mt-2">
          Books from Catalog. Reader status auto-flips as you move titles through Applied → Received → Reviewed.
        </p>
        <ReaderBookSection
          label="Applied for"
          relationship="applied"
          bookIds={appliedIds}
          catalogBooks={catalogBooks}
          unmatched={unmatched.applied}
          onAdd={id => setAppliedIds(prev => prev.includes(id) ? prev : [...prev, id])}
          onRemove={id => setAppliedIds(prev => prev.filter(b => b !== id))}
          onDismissUnmatched={onDismissUnmatched ? t => onDismissUnmatched(t, 'applied') : undefined}
        />
        <ReaderBookSection
          label="Received"
          relationship="received"
          bookIds={receivedIds}
          catalogBooks={catalogBooks}
          unmatched={unmatched.received}
          onAdd={id => setReceivedIds(prev => prev.includes(id) ? prev : [...prev, id])}
          onRemove={id => setReceivedIds(prev => prev.filter(b => b !== id))}
          onDismissUnmatched={onDismissUnmatched ? t => onDismissUnmatched(t, 'received') : undefined}
        />
        <ReaderBookSection
          label="Reviewed"
          relationship="reviewed"
          bookIds={reviewedIds}
          catalogBooks={catalogBooks}
          unmatched={unmatched.reviewed}
          onAdd={id => setReviewedIds(prev => prev.includes(id) ? prev : [...prev, id])}
          onRemove={id => setReviewedIds(prev => prev.filter(b => b !== id))}
          onDismissUnmatched={onDismissUnmatched ? t => onDismissUnmatched(t, 'reviewed') : undefined}
        />
      </div>

      {/* Where they review */}
      <div className={sectionCls}>
        <label className={labelCls}>Places they review</label>
        <div className="flex flex-wrap gap-1.5">
          {PLACES.map(p => {
            const on = draft.place_to_review.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleArr('place_to_review', p)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  on ? 'bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Opt-ins + notes */}
      <div className={sectionCls}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.newsletter_subscribed} onChange={e => setDraft(d => ({ ...d, newsletter_subscribed: e.target.checked }))} />
            Subscribed to newsletter
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.promo_team} onChange={e => setDraft(d => ({ ...d, promo_team: e.target.checked }))} />
            On promo team
          </label>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea rows={4} className={inputCls} value={draft.notes ?? ''} onChange={e => setText('notes', e.target.value)} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div>
          {onDelete && (
            <button
              type="button"
              onClick={() => { if (confirm(`Delete ${draft.name}?`)) onDelete(); }}
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
            disabled={saving || !draft.name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 rounded-lg"
          >
            {saving ? 'Saving…' : initial ? 'Save changes' : 'Add reader'}
          </button>
        </div>
      </div>
    </form>
  );
}

