// Logic tests for the opportunity engine + pipeline percent. Run via:
//   npx tsx src/lib/opportunities.test.ts
// Pure functions, no Supabase involved.

import assert from 'node:assert';
import { deriveOpportunities, pipelinePercent, type OpportunityDecision } from './opportunities';
import type { Book } from '../modules/catalog/types';
import type { Manuscript } from '../modules/writing/types';

let bookSeq = 0;
function makeBook(over: Partial<Book>): Book {
  bookSeq += 1;
  return {
    id: over.id ?? `book-${bookSeq}`,
    user_id: 'u1',
    title: 'Untitled',
    subtitle: null,
    series: null,
    series_position: null,
    pen_name_id: null,
    language: null,
    parent_book_id: null,
    status: 'published',
    publish_date: null,
    pre_order_date: null,
    manuscript_due_date: null,
    ebook_price: 4.99,
    paperback_price: 14.99,
    hardcover_price: 24.99,
    audiobook_price: null,
    blurb: null,
    content_warnings: null,
    kinks: null,
    tropes: [],
    heat_level: null,
    subgenre: null,
    page_count: null,
    word_count: null,
    target_word_count: null,
    current_chapter: null,
    asin: null,
    isbn_ebook: null,
    isbn_paperback: null,
    isbn_audiobook: '978-audio',
    isbn_hardcover: null,
    amazon_keywords: ['dark romance'],
    keywords: [],
    bisac_categories: [],
    reviews: [],
    cover_url: null,
    notes: null,
    include_in_arcs: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeManuscript(over: Partial<Manuscript>): Manuscript {
  return {
    id: 'ms-1',
    user_id: 'u1',
    book_id: null,
    title: 'MS',
    status: 'draft',
    source_filename: null,
    word_count: 0,
    target_word_count: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const NOW = new Date('2026-07-20T12:00:00Z');

console.log('Test 1: published original with no translations yields translation opportunities');
{
  const book = makeBook({ id: 'b1', title: 'Vicious Beast' });
  const ops = deriveOpportunities([book], [], [], NOW);
  const translations = ops.filter(o => o.kind === 'translation');
  assert(translations.length > 0, 'has translation opportunities');
  assert(translations.every(o => o.bookId === 'b1'), 'all target the original');
}

console.log('Test 2: existing translation child removes that language only');
{
  const book = makeBook({ id: 'b1', title: 'Vicious Beast' });
  const de = makeBook({ id: 'b2', title: 'Vicious Beast - GE', language: 'de', parent_book_id: 'b1' });
  const ops = deriveOpportunities([book, de], [], [], NOW);
  assert(!ops.some(o => o.key === 'translation:de'), 'no German suggestion');
  assert(ops.some(o => o.key === 'translation:fr'), 'French still suggested');
}

console.log('Test 3: translations themselves generate no opportunities');
{
  const book = makeBook({ id: 'b1' });
  const de = makeBook({ id: 'b2', language: 'de', parent_book_id: 'b1', isbn_audiobook: null });
  const ops = deriveOpportunities([book, de], [], [], NOW);
  assert(!ops.some(o => o.bookId === 'b2'), 'child book yields nothing');
}

console.log('Test 4: languages the catalog uses outrank never-used ones');
{
  const b1 = makeBook({ id: 'b1' });
  const de = makeBook({ id: 'b2', language: 'de', parent_book_id: 'b1' });
  const b3 = makeBook({ id: 'b3' });
  const ops = deriveOpportunities([b1, de, b3], [], [], NOW);
  const deOp = ops.find(o => o.bookId === 'b3' && o.key === 'translation:de')!;
  const jaOp = ops.find(o => o.bookId === 'b3' && o.key === 'translation:ja')!;
  assert(deOp.score > jaOp.score, 'German (used) scores above Japanese (never used)');
}

console.log('Test 5: audiobook gap requires no ISBN and no project');
{
  const gap = makeBook({ id: 'b1', isbn_audiobook: null });
  const hasIsbn = makeBook({ id: 'b2' });
  const hasProject = makeBook({ id: 'b3', isbn_audiobook: null });
  const ops = deriveOpportunities(
    [gap, hasIsbn, hasProject],
    [{ book_id: 'b3', status: 'in_progress' }],
    [],
    NOW,
  );
  assert(ops.some(o => o.bookId === 'b1' && o.key === 'audiobook'), 'b1 flagged');
  assert(!ops.some(o => o.bookId === 'b2' && o.key === 'audiobook'), 'b2 has ISBN');
  assert(!ops.some(o => o.bookId === 'b3' && o.key === 'audiobook'), 'b3 has a project');
}

console.log('Test 6: non-published books yield nothing');
{
  const drafting = makeBook({ id: 'b1', status: 'drafting', isbn_audiobook: null, amazon_keywords: [] });
  const ops = deriveOpportunities([drafting], [], [], NOW);
  assert(ops.length === 0, 'drafting book generates no opportunities');
}

console.log('Test 7: format and KDP gaps');
{
  const book = makeBook({ id: 'b1', paperback_price: null, hardcover_price: null, amazon_keywords: [] });
  const ops = deriveOpportunities([book], [], [], NOW);
  assert(ops.some(o => o.key === 'format:paperback'), 'paperback gap');
  assert(ops.some(o => o.key === 'format:hardcover'), 'hardcover gap');
  assert(ops.some(o => o.key === 'kdp'), 'keyword gap');
}

console.log('Test 8: ARC gap only within 60 days of publish');
{
  const recent = makeBook({ id: 'b1', include_in_arcs: false, publish_date: '2026-07-01' });
  const old = makeBook({ id: 'b2', include_in_arcs: false, publish_date: '2026-01-01' });
  const ops = deriveOpportunities([recent, old], [], [], NOW);
  assert(ops.some(o => o.bookId === 'b1' && o.kind === 'arc'), 'recent release flagged');
  assert(!ops.some(o => o.bookId === 'b2' && o.kind === 'arc'), 'old release not flagged');
}

console.log('Test 9: dismissal zeroes the score; planned keeps it');
{
  const book = makeBook({ id: 'b1', isbn_audiobook: null });
  const decisions: OpportunityDecision[] = [
    { book_id: 'b1', opportunity_key: 'audiobook', decision: 'dismissed' },
    { book_id: 'b1', opportunity_key: 'translation:de', decision: 'planned' },
  ];
  const ops = deriveOpportunities([book], [], decisions, NOW);
  const audio = ops.find(o => o.key === 'audiobook')!;
  const de = ops.find(o => o.key === 'translation:de')!;
  assert(audio.score === 0 && audio.decision === 'dismissed', 'dismissed → score 0');
  assert(de.score > 0 && de.decision === 'planned', 'planned keeps score');
}

console.log('Test 10: series membership boosts scores');
{
  const solo = makeBook({ id: 'b1', isbn_audiobook: null });
  const s1 = makeBook({ id: 'b2', series: 'Crowns', isbn_audiobook: null });
  const s2 = makeBook({ id: 'b3', series: 'Crowns' });
  const s3 = makeBook({ id: 'b4', series: 'Crowns' });
  const ops = deriveOpportunities([solo, s1, s2, s3], [], [], NOW);
  const soloAudio = ops.find(o => o.bookId === 'b1' && o.key === 'audiobook')!;
  const seriesAudio = ops.find(o => o.bookId === 'b2' && o.key === 'audiobook')!;
  assert(seriesAudio.score > soloAudio.score, 'series book outranks standalone');
}

console.log('Test 11: pipelinePercent stages');
{
  const idea = makeBook({ id: 'b1', status: 'idea', paperback_price: null, hardcover_price: null, isbn_audiobook: null });
  assert(pipelinePercent(idea, null, []) === 0, 'idea with nothing = 0');

  const draftingMs = makeManuscript({ book_id: 'b2', status: 'draft', word_count: 10_000, target_word_count: 60_000 });
  const drafting = makeBook({ id: 'b2', status: 'drafting', paperback_price: null, hardcover_price: null, isbn_audiobook: null });
  assert(pipelinePercent(drafting, draftingMs, []) === 10, 'manuscript only = 10');

  const published = makeBook({ id: 'b3', status: 'published' });
  const finalMs = makeManuscript({ book_id: 'b3', status: 'final' });
  assert(pipelinePercent(published, finalMs, []) === 100, 'fully done = 100');

  const publishedNoAudio = makeBook({ id: 'b4', status: 'published', isbn_audiobook: null });
  assert(pipelinePercent(publishedNoAudio, finalMs, []) === 95, 'missing audiobook = 95');
  const dismissed: OpportunityDecision[] = [{ book_id: 'b4', opportunity_key: 'audiobook', decision: 'dismissed' }];
  assert(pipelinePercent(publishedNoAudio, finalMs, [], dismissed) === 100, 'dismissed audiobook counts as done');
}

console.log('Test 12: word target met counts as draft complete without a manuscript');
{
  const book = makeBook({
    id: 'b1', status: 'drafting', word_count: 60_000, target_word_count: 60_000,
    paperback_price: null, hardcover_price: null, isbn_audiobook: null,
  });
  assert(pipelinePercent(book, null, []) === 25, 'target met without manuscript = 25');
}

console.log('\nAll opportunity engine tests passed.');
