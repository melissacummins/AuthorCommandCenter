import { useMemo } from 'react';
import {
  AlertCircle, CalendarClock, CheckCircle2, Edit3, Library, Layers,
} from 'lucide-react';
import type { Book, BookStatus } from '../types';
import { STATUS_COLORS, STATUS_LABELS } from '../types';

interface Props {
  books: Book[];
  onOpenBook: (book: Book) => void;
  /** Map of catalog book.id -> count of selected KDP keywords, if any. */
  kdpKeywordCounts?: Record<string, number>;
}

const STATUS_ORDER: BookStatus[] = ['idea', 'drafting', 'editing', 'pre_order', 'published', 'paused'];

// "in 12 days", "in 3 months", "today", "2 weeks ago"
function relativeDate(iso: string | null): string | null {
  if (!iso) return null;
  const target = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = target.getTime() - today.getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0 && days < 14) return `in ${days} days`;
  if (days < 0 && days > -14) return `${-days} days ago`;
  const weeks = Math.round(days / 7);
  if (Math.abs(weeks) < 9) return weeks > 0 ? `in ${weeks} weeks` : `${-weeks} weeks ago`;
  const months = Math.round(days / 30);
  return months > 0 ? `in ${months} months` : `${-months} months ago`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface UpcomingEvent {
  book: Book;
  label: string;
  date: string;
  daysAway: number;
}

function buildUpcoming(books: Book[]): UpcomingEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events: UpcomingEvent[] = [];
  for (const b of books) {
    const add = (date: string | null, label: string) => {
      if (!date) return;
      const d = new Date(date + 'T00:00:00');
      const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (days < -7 || days > 180) return;
      events.push({ book: b, label, date, daysAway: days });
    };
    add(b.publish_date, 'Publish');
    add(b.pre_order_date, 'Pre-order live');
    add(b.manuscript_due_date, 'Manuscript due');
  }
  events.sort((a, b) => a.daysAway - b.daysAway);
  return events;
}

interface ActionItem {
  book: Book;
  reason: string;
}

// Published books are excluded by default — they're done, not "awaiting";
// their gaps show only in the opt-in Completeness panel (includePublished).
function buildAwaitingAction(books: Book[], kdpCounts: Record<string, number>, includePublished = false): ActionItem[] {
  const items: ActionItem[] = [];
  for (const b of books) {
    if (!includePublished && b.status === 'published') continue;
    if (!b.cover_url) items.push({ book: b, reason: 'Missing cover' });
    if (!b.blurb) items.push({ book: b, reason: 'Missing blurb' });
    if (b.status === 'pre_order' && !b.publish_date) {
      items.push({ book: b, reason: 'Pre-order without publish date' });
    }
    if (b.status === 'published' && !b.isbn_ebook && !b.isbn_paperback && !b.isbn_audiobook && !b.isbn_hardcover) {
      items.push({ book: b, reason: 'Published without any ISBN' });
    }
    if ((b.status === 'drafting' || b.status === 'editing') && !b.target_word_count) {
      items.push({ book: b, reason: 'WIP without a target word count' });
    }
    // Treat keywords from a linked KDP Optimizer book as satisfying this
    // check too — no need to enter them twice.
    const kdpCount = kdpCounts[b.id] ?? 0;
    if (
      b.amazon_keywords.length === 0 &&
      kdpCount === 0 &&
      (b.status === 'pre_order' || b.status === 'published')
    ) {
      items.push({ book: b, reason: 'No Amazon keywords set' });
    }
  }
  return items;
}

function activeWips(books: Book[]): Book[] {
  return books.filter(b => b.status === 'drafting' || b.status === 'editing');
}

function bySeries(books: Book[]): { series: string; books: Book[] }[] {
  const groups = new Map<string, Book[]>();
  for (const b of books) {
    if (!b.series) continue;
    const arr = groups.get(b.series) ?? [];
    arr.push(b);
    groups.set(b.series, arr);
  }
  return Array.from(groups.entries())
    .map(([series, list]) => ({
      series,
      books: list.sort((a, b) => (a.series_position ?? 99) - (b.series_position ?? 99)),
    }))
    .sort((a, b) => a.series.localeCompare(b.series));
}

export default function CatalogOverview({ books, onOpenBook, kdpKeywordCounts = {} }: Props) {
  const statusCounts = useMemo(() => {
    const c: Record<BookStatus, number> = {
      idea: 0, drafting: 0, editing: 0, pre_order: 0, published: 0, paused: 0,
    };
    books.forEach(b => { c[b.status]++; });
    return c;
  }, [books]);

  const upcoming = useMemo(() => buildUpcoming(books), [books]);
  const awaiting = useMemo(() => buildAwaitingAction(books, kdpKeywordCounts), [books, kdpKeywordCounts]);
  const completeness = useMemo(() => buildAwaitingAction(books, kdpKeywordCounts, true), [books, kdpKeywordCounts]);
  const wips = useMemo(() => activeWips(books), [books]);
  const series = useMemo(() => bySeries(books), [books]);

  if (books.length === 0) {
    return (
      <div className="text-center py-16 bg-surface rounded-card border border-dashed border-edge-strong">
        <Library className="w-10 h-10 text-brand-400 mx-auto mb-3" />
        <p className="text-sm text-content-secondary">Add a book to start seeing your catalog overview.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status counts */}
      <section>
        <h2 className={sectionLabel}>By status</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {STATUS_ORDER.map(s => (
            <div key={s} className="bg-surface rounded-card border border-edge p-3">
              <div className="text-2xl font-bold text-content">{statusCounts[s]}</div>
              <div className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 ${STATUS_COLORS[s]}`}>
                {STATUS_LABELS[s]}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming */}
        <section>
          <h2 className={sectionLabel}>
            <CalendarClock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> Upcoming dates
          </h2>
          <div className="bg-surface rounded-card border border-edge divide-y divide-edge-soft">
            {upcoming.length === 0 ? (
              <EmptyRow text="Nothing on the calendar in the next 6 months." />
            ) : (
              upcoming.map((e, i) => (
                <button
                  key={`${e.book.id}-${e.label}-${i}`}
                  onClick={() => onOpenBook(e.book)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-content truncate">{e.book.title}</div>
                    <div className="text-xs text-content-secondary">{e.label} · {formatDate(e.date)}</div>
                  </div>
                  <span className={`text-xs whitespace-nowrap font-medium ${e.daysAway < 0 ? 'text-rose-600' : e.daysAway <= 14 ? 'text-amber-600' : 'text-content-secondary'}`}>
                    {relativeDate(e.date)}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Awaiting action */}
        <section>
          <h2 className={sectionLabel}>
            <AlertCircle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> Awaiting you
          </h2>
          <div className="bg-surface rounded-card border border-edge divide-y divide-edge-soft">
            {awaiting.length === 0 ? (
              <EmptyRow text={<><CheckCircle2 className="w-4 h-4 inline mr-1 text-emerald-500" /> Everything's filled in.</>} />
            ) : (
              awaiting.map((a, i) => (
                <button
                  key={`${a.book.id}-${a.reason}-${i}`}
                  onClick={() => onOpenBook(a.book)}
                  className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-content truncate">{a.book.title}</div>
                    <div className="text-xs text-content-secondary">{a.reason}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[a.book.status]}`}>
                    {STATUS_LABELS[a.book.status]}
                  </span>
                </button>
              ))
            )}
          </div>
          {completeness.length > awaiting.length && (
            <details className="mt-2">
              <summary className="text-xs text-content-muted cursor-pointer select-none hover:text-content-secondary">
                Completeness — {completeness.length - awaiting.length} more item{completeness.length - awaiting.length === 1 ? '' : 's'} on published books (nothing urgent)
              </summary>
              <div className="mt-2 bg-surface rounded-card border border-edge divide-y divide-edge-soft">
                {completeness.filter(c => c.book.status === 'published').map((a, i) => (
                  <button
                    key={`${a.book.id}-${a.reason}-c${i}`}
                    onClick={() => onOpenBook(a.book)}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-content-secondary truncate">{a.book.title}</div>
                      <div className="text-xs text-content-muted">{a.reason}</div>
                    </div>
                  </button>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>

      {/* Active WIPs */}
      {wips.length > 0 && (
        <section>
          <h2 className={sectionLabel}>
            <Edit3 className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> Active work in progress
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {wips.map(b => {
              const wc = b.word_count ?? 0;
              const target = b.target_word_count ?? 0;
              const pct = target > 0 ? Math.min(100, Math.round((wc / target) * 100)) : null;
              return (
                <button
                  key={b.id}
                  onClick={() => onOpenBook(b)}
                  className="text-left bg-surface rounded-card border border-edge p-4 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-medium text-content truncate">{b.title}</div>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[b.status]}`}>
                      {STATUS_LABELS[b.status]}
                    </span>
                  </div>
                  {b.current_chapter && (
                    <div className="text-xs text-content-secondary mb-2">Chapter: {b.current_chapter}</div>
                  )}
                  {target > 0 ? (
                    <>
                      <div className="flex items-baseline justify-between text-xs text-content-secondary mb-1">
                        <span>{wc.toLocaleString()} / {target.toLocaleString()} words</span>
                        <span className="font-semibold">{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                        <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-content-muted">
                      {wc.toLocaleString()} words · set a target to see progress
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Series view */}
      {series.length > 0 && (
        <section>
          <h2 className={sectionLabel}>
            <Layers className="w-3.5 h-3.5 inline mr-1 -mt-0.5" /> Series
          </h2>
          <div className="space-y-3">
            {series.map(group => (
              <div key={group.series} className="bg-surface rounded-card border border-edge p-4">
                <div className="font-semibold text-content mb-2">{group.series}</div>
                <div className="space-y-1">
                  {group.books.map(b => (
                    <button
                      key={b.id}
                      onClick={() => onOpenBook(b)}
                      className="w-full text-left flex items-center justify-between gap-3 px-2 py-1.5 rounded hover:bg-surface-hover"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-content-muted font-mono w-6 shrink-0">
                          #{b.series_position ?? '?'}
                        </span>
                        <span className="text-sm text-content truncate">{b.title}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[b.status]}`}>
                        {STATUS_LABELS[b.status]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyRow({ text }: { text: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-content-secondary">{text}</div>;
}

const sectionLabel = 'text-xs font-semibold uppercase tracking-wider text-content-secondary mb-2';
