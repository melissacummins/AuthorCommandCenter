// Unit tests for the legacy export parser. Run via:
//   npx tsx src/modules/book-tracker/import.test.ts

import { parseLegacyExport } from './import';
import { normalizeQuarterSortKey, parseTitleEdition } from './types';

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

// ---- quarter sort key normalization ----
assertEq(normalizeQuarterSortKey('Q4 2024'),    '2024-Q4', 'normalize "Q4 2024"');
assertEq(normalizeQuarterSortKey('Q1 2022'),    '2022-Q1', 'normalize "Q1 2022"');
assertEq(normalizeQuarterSortKey('q3 2022'),    '2022-Q3', 'normalize "q3 2022" (case-insensitive)');
assertEq(normalizeQuarterSortKey('12/31/2024'), '2024-12-31', 'normalize "12/31/2024"');
assertEq(normalizeQuarterSortKey('07/31/2025'), '2025-07-31', 'normalize "07/31/2025"');
assertEq(normalizeQuarterSortKey('9/30/2024'),  '2024-09-30', 'normalize "9/30/2024"');
assertEq(normalizeQuarterSortKey('2024-12-31'), '2024-12-31', 'normalize ISO date passthrough');

// ---- title edition parsing ----
assertEq(parseTitleEdition('Night Shade'),         { base: 'Night Shade', edition: null },  'edition: no suffix');
assertEq(parseTitleEdition('Night Shade - GE'),    { base: 'Night Shade', edition: 'GE' }, 'edition: GE');
assertEq(parseTitleEdition('Crowned In Blood - FR'),{ base: 'Crowned In Blood', edition: 'FR' }, 'edition: FR');
assertEq(parseTitleEdition('My Brutal Beast - GE'), { base: 'My Brutal Beast', edition: 'GE' }, 'edition: multi-word base');

// ---- legacy export parsing ----
const fixture = {
  exportDate: '2026-05-21T11:01:26.997Z',
  userEmail: 'test@example.com',
  version: '5.1',
  books: [
    {
      id: 1757373690534,
      title: 'My Vicious Beast',
      devCost: 0,
      cumulativeProfit: 0,
      launchDate: null,
      createdAt: '2025-09-08T23:21:30.534Z',
      quarterlyUpdates: [],
      costBreakdown: [],
    },
    {
      id: 1757379001118,
      title: 'Crowned In Blood - FR',
      devCost: 111.36,
      launchDate: null,
      costBreakdown: [
        { amount: 97.5, category: 'Formatting' },
        { amount: 13.86, category: 'Other' },
      ],
      quarterlyUpdates: [],
    },
  ],
  paidOffBooks: [
    {
      id: 1757324207150,
      title: 'Night Shade',
      devCost: 1663.57,
      cumulativeProfit: 2284.64,
      launchDate: '2021-09-28',
      payoffDate: '2022-09-30T00:00:00.000Z',
      payoffQuarter: 'Q3 2022',
      monthsToPayoff: 12,
      finalProfit: 2284.64,
      costBreakdown: [
        { category: 'Cover Design', amount: 974.33 },
        { category: 'Editing',      amount: 575.24 },
        { category: 'Other',        amount: 114 },
      ],
      quarterlyUpdates: [
        { quarter: 'Q4 2021', profit: 607.6,  date: '2025-09-08T10:08:50.009Z' },
        { quarter: 'Q3 2022', profit: 1677.04, date: '2025-09-08T10:11:03.067Z' },
      ],
    },
  ],
};

const result = parseLegacyExport(fixture);

assertEq(result.summary.active, 2, 'summary: 2 active books');
assertEq(result.summary.paidOff, 1, 'summary: 1 paid-off book');
assertEq(result.summary.totalUpdates, 2, 'summary: 2 quarterly updates total');
assertEq(result.summary.warnings.length, 0, 'summary: no warnings for clean input');

assertEq(result.parsed.length, 3, 'parsed: 3 books total');

const vicious = result.parsed.find(p => p.book.title === 'My Vicious Beast')!;
assertEq(vicious.book.status, 'active', 'active book carries status=active');
assertEq(vicious.book.legacy_id, 1757373690534, 'active book preserves legacy_id');
assertEq(vicious.book.dev_cost, 0, 'active book preserves dev_cost');
assertEq(vicious.book.launch_date, null, 'active book preserves null launch_date');
assertEq(vicious.updates.length, 0, 'active book with no updates yields empty array');

const fr = result.parsed.find(p => p.book.title === 'Crowned In Blood - FR')!;
assertEq(fr.book.cost_breakdown!.length, 2, 'cost breakdown rows preserved');
assertEq(fr.book.cost_breakdown![0].amount, 97.5, 'cost breakdown amount preserved');
assertEq(fr.book.dev_cost, 111.36, 'dev_cost preserved on translation');

const nightShade = result.parsed.find(p => p.book.title === 'Night Shade')!;
assertEq(nightShade.book.status, 'paid_off', 'paid-off book gets status=paid_off');
assertEq(nightShade.book.launch_date, '2021-09-28', 'pure ISO date preserved verbatim');
assertEq(nightShade.updates.length, 2, 'paid-off book imports its quarterly updates');
assertEq(nightShade.updates[0].quarter_label, 'Q4 2021', 'quarter_label preserved');
assertEq(nightShade.updates[0].profit, 607.6, 'profit preserved');

// ---- defensive parsing ----
const empty = parseLegacyExport({});
assertEq(empty.parsed.length, 0, 'empty object yields no books');
assertEq(empty.summary.warnings.length, 1, 'empty object surfaces a warning');

const garbage = parseLegacyExport(null);
assertEq(garbage.parsed.length, 0, 'null input yields no books');
assertEq(garbage.summary.warnings.length, 1, 'null input warns');

const missingTitle = parseLegacyExport({ books: [{ id: 123 }] });
assertEq(missingTitle.parsed.length, 0, 'book missing title is skipped');
assertEq(missingTitle.summary.warnings.length, 1, 'book missing title warns');

// ---- launch_date timezone-safe ----
const tzShifted = parseLegacyExport({
  paidOffBooks: [{
    id: 1, title: 'TZ Test', devCost: 0, launchDate: '2025-06-29T21:00:00.000Z',
    costBreakdown: [], quarterlyUpdates: [],
  }],
});
assertEq(tzShifted.parsed[0].book.launch_date, '2025-06-29', 'UTC time-of-day does not push date back a day');

console.log(failures === 0 ? '\nAll tests passed.' : `\n${failures} test(s) failed.`);
if (failures > 0) process.exit(1);
