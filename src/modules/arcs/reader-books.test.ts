// Unit tests for the pure helpers added in Phase 2. Run via:
//   npx tsx src/modules/arcs/reader-books.test.ts
// Network-touching helpers (linkReaderBooksFromTitles, etc.) are
// covered indirectly via the migration's backfill, which we don't run
// in this script — these tests focus on the deterministic pieces
// callers rely on for status implication and book-id projection.

import {
  impliedFunnelStatus,
  impliedFunnelStatusFromReader,
  readerBookCount,
  readerBookIds,
  type ArcReader,
  type ReaderBook,
} from './types';

let failures = 0;
function assertEq<T>(actual: T, expected: T, label: string) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures += 1;
    console.error(`FAIL  ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function rb(book_id: string, relationship: 'applied' | 'received' | 'reviewed'): ReaderBook {
  return {
    id: `rb-${book_id}-${relationship}`,
    reader_id: 'reader-1',
    book_id,
    relationship,
    recorded_at: '2026-01-01T00:00:00Z',
    book_title: `Book ${book_id}`,
    pen_name_id: null,
  };
}

function reader(over: Partial<ArcReader> = {}): ArcReader {
  return {
    id: 'reader-1',
    user_id: 'user-1',
    name: 'Test Reader',
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
    reader_books: [],
    place_to_review: [],
    newsletter_subscribed: false,
    promo_team: false,
    notes: null,
    external_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

// ---- impliedFunnelStatus (legacy callers, mixed input types) ----
assertEq(impliedFunnelStatus([], [], []),                                            'new',                  'no history → new');
assertEq(impliedFunnelStatus(['t'], [], []),                                          'awaiting_arc',         'applied only → awaiting_arc');
assertEq(impliedFunnelStatus(['t'], ['t'], []),                                       'awaiting_review',      'received present → awaiting_review (even if applied)');
assertEq(impliedFunnelStatus([], [], ['t']),                                          'current_arc_member',   'reviewed only → current_arc_member');
assertEq(impliedFunnelStatus([rb('a', 'applied')], [rb('b', 'received')], []),        'awaiting_review',      'mixed types: arrays of ReaderBook');

// ---- impliedFunnelStatusFromReader (junction-aware) ----
assertEq(impliedFunnelStatusFromReader(reader({ reader_books: [] })), 'new', 'reader with no junction → new');
assertEq(
  impliedFunnelStatusFromReader(reader({ reader_books: [rb('a', 'applied')] })),
  'awaiting_arc',
  'reader with applied only → awaiting_arc',
);
assertEq(
  impliedFunnelStatusFromReader(reader({ reader_books: [rb('a', 'applied'), rb('b', 'received')] })),
  'awaiting_review',
  'reader with received → awaiting_review',
);
assertEq(
  impliedFunnelStatusFromReader(reader({ reader_books: [rb('a', 'reviewed'), rb('b', 'received')] })),
  'current_arc_member',
  'reader with any reviewed → current_arc_member regardless of received',
);

// ---- readerBookCount / readerBookIds projection ----
const r = reader({
  reader_books: [
    rb('a', 'applied'),
    rb('b', 'applied'),
    rb('c', 'received'),
    rb('d', 'reviewed'),
  ],
});
assertEq(readerBookCount(r, 'applied'),  2, 'count applied');
assertEq(readerBookCount(r, 'received'), 1, 'count received');
assertEq(readerBookCount(r, 'reviewed'), 1, 'count reviewed');
assertEq(readerBookIds(r, 'applied'),  ['a', 'b'], 'ids applied');
assertEq(readerBookIds(r, 'received'), ['c'],      'ids received');
assertEq(readerBookIds(r, 'reviewed'), ['d'],      'ids reviewed');

// readerBookCount on a reader with no junction yet (e.g. raw insert
// before refetch) should be 0, not undefined / NaN.
assertEq(readerBookCount(reader({ reader_books: undefined }), 'reviewed'), 0, 'count handles missing reader_books');
assertEq(readerBookIds(reader({ reader_books: undefined }), 'reviewed'), [], 'ids handles missing reader_books');

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
if (failures > 0) process.exit(1);
