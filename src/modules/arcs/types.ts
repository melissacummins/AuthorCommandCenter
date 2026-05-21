export type ReaderBookRelationship = 'applied' | 'received' | 'reviewed';

// One row out of the arc_reader_books junction joined with books.
// Used to render per-reader book history and (later) timeline events.
export interface ReaderBook {
  id: string;
  reader_id: string;
  book_id: string;
  relationship: ReaderBookRelationship;
  recorded_at: string;
  // Joined fields from books / pen_names so the UI doesn't need a
  // second lookup per row.
  book_title: string;
  pen_name_id: string | null;
}

// Free-text titles from the legacy applied_for/received/reviewed
// columns that couldn't be matched to any Catalog book at backfill.
// The UI surfaces these so the user can either add the book to Catalog
// and link it, or dismiss the entry.
export interface UnmatchedTitles {
  applied?: string[];
  received?: string[];
  reviewed?: string[];
}

export type ArcStatus =
  | 'new'
  | 'current_arc_member'
  | 'awaiting_arc'
  | 'awaiting_review'
  | 'didnt_review'
  | 'didnt_download'
  | 'on_tbr_no_review'
  | 'not_moving_forward'
  | 'special_circumstances'
  | 'insufficient_information'
  | 'not_pending_anything';

export interface ArcReader {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  primary_sm: string | null;
  ig_profile_url: string | null;
  tt_profile_url: string | null;
  threads_profile_url: string | null;
  fb_profile_url: string | null;
  goodreads_profile_url: string | null;
  amazon_reviewer_url: string | null;
  blog_url: string | null;
  status: ArcStatus;
  // Legacy free-text columns. New code reads/writes the junction
  // (reader_books below) — these stay populated only from historical
  // data and are not touched by the current UI. Will be dropped once
  // we're confident the cutover is clean.
  applied_for: string[];
  received: string[];
  reviewed: string[];
  // Joined from arc_reader_books on the way out — present when the
  // listArcReaders / getArcReader queries hydrate it; undefined on
  // raw inserts.
  reader_books?: ReaderBook[];
  // Backfill leftovers from migration 031 — titles that couldn't be
  // matched to Catalog. Surfaced in the UI for manual cleanup.
  unmatched_titles?: UnmatchedTitles;
  place_to_review: string[];
  newsletter_subscribed: boolean;
  promo_team: boolean;
  notes: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ArcReaderInsert = Omit<ArcReader, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'reader_books' | 'unmatched_titles'>;
export type ArcReaderUpdate = Partial<ArcReaderInsert>;

// Convenience accessors used by status implication + filter logic that
// previously inspected the TEXT[] arrays directly. New code reads
// these instead of reader.applied_for etc.
export function readerBookIds(reader: ArcReader, relationship: ReaderBookRelationship): string[] {
  return (reader.reader_books ?? [])
    .filter(rb => rb.relationship === relationship)
    .map(rb => rb.book_id);
}

export function readerBookCount(reader: ArcReader, relationship: ReaderBookRelationship): number {
  return (reader.reader_books ?? []).filter(rb => rb.relationship === relationship).length;
}

export const STATUS_ORDER: ArcStatus[] = [
  'new',
  'awaiting_arc',
  'current_arc_member',
  'awaiting_review',
  'didnt_review',
  'didnt_download',
  'on_tbr_no_review',
  'special_circumstances',
  'insufficient_information',
  'not_moving_forward',
  'not_pending_anything',
];

// Statuses that move automatically when per-book arrays change.
// Other statuses (didnt_review, not_moving_forward, etc.) are explicit
// user decisions and we leave them alone.
export const FUNNEL_STATUSES: readonly ArcStatus[] = [
  'new', 'awaiting_arc', 'awaiting_review', 'current_arc_member',
];

export function isFunnelStatus(s: ArcStatus): boolean {
  return (FUNNEL_STATUSES as readonly ArcStatus[]).includes(s);
}

// Highest funnel state implied by the reader's per-book history.
// Accepts either the new junction rows or the legacy TEXT[] arrays so
// callers in the middle of the cutover can pass whichever they have.
export function impliedFunnelStatus(
  applied: ReaderBook[] | string[],
  received: ReaderBook[] | string[],
  reviewed: ReaderBook[] | string[],
): ArcStatus {
  if (reviewed.length > 0) return 'current_arc_member';
  if (received.length > 0) return 'awaiting_review';
  if (applied.length > 0) return 'awaiting_arc';
  return 'new';
}

// Variant that takes the joined reader directly — preferred for new
// code so the call site doesn't have to filter by relationship itself.
export function impliedFunnelStatusFromReader(reader: ArcReader): ArcStatus {
  const rbs = reader.reader_books ?? [];
  const r = rbs.filter(b => b.relationship === 'reviewed');
  if (r.length > 0) return 'current_arc_member';
  const rc = rbs.filter(b => b.relationship === 'received');
  if (rc.length > 0) return 'awaiting_review';
  const a = rbs.filter(b => b.relationship === 'applied');
  if (a.length > 0) return 'awaiting_arc';
  return 'new';
}

export const STATUS_LABELS: Record<ArcStatus, string> = {
  new: 'New',
  current_arc_member: 'Current ARC Member',
  awaiting_arc: 'Awaiting ARC',
  awaiting_review: 'Awaiting Review',
  didnt_review: "Didn't Review",
  didnt_download: "Didn't Download",
  on_tbr_no_review: 'On TBR, No Review',
  not_moving_forward: 'Not Moving Forward',
  special_circumstances: 'Special Circumstances',
  insufficient_information: 'Insufficient Information',
  not_pending_anything: 'Not Pending Anything',
};

export const STATUS_COLORS: Record<ArcStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  current_arc_member: 'bg-pink-100 text-pink-800',
  awaiting_arc: 'bg-amber-100 text-amber-800',
  awaiting_review: 'bg-amber-100 text-amber-800',
  didnt_review: 'bg-purple-100 text-purple-800',
  didnt_download: 'bg-orange-100 text-orange-800',
  on_tbr_no_review: 'bg-yellow-100 text-yellow-800',
  not_moving_forward: 'bg-rose-100 text-rose-800',
  special_circumstances: 'bg-violet-100 text-violet-800',
  insufficient_information: 'bg-slate-100 text-slate-700',
  not_pending_anything: 'bg-slate-100 text-slate-600',
};

export const NOTION_STATUS_MAP: Record<string, ArcStatus> = {
  'Current ARC Member': 'current_arc_member',
  "Didn't Review": 'didnt_review',
  'Awaiting Review': 'awaiting_review',
  'Special circumstances': 'special_circumstances',
  "Didn't download": 'didnt_download',
  'Awaiting ARC': 'awaiting_arc',
  'Not moving forward': 'not_moving_forward',
  'On TBR no review': 'on_tbr_no_review',
  New: 'new',
  'Insufficient information': 'insufficient_information',
  'Not Pending Anything': 'not_pending_anything',
};

export const PLACES = [
  'Amazon',
  'Apple',
  'B&N',
  'Goodreads',
  'Google Play',
  'Kobo',
  'Social Media',
  'Bookbub',
  'Your Blog',
  'Smashwords',
  'Storygraph',
  'Podcast (or other media outlet)',
  'Other',
] as const;
