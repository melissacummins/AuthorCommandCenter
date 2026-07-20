// Pure opportunity derivation for the Command Center dashboard and the
// Catalog checklist tab (redesign directive §3.2–3.3). No I/O here — callers
// (src/lib/dashboard.ts, Catalog) fetch the inputs and render the outputs,
// which keeps every rule unit-testable via src/lib/opportunities.test.ts.

import type { Book } from '../modules/catalog/types';
import { TRANSLATION_LANGUAGES, languageLabel } from '../modules/catalog/types';
import type { Manuscript } from '../modules/writing/types';

export type OpportunityKind = 'translation' | 'audiobook' | 'format' | 'kdp' | 'arc';
export type OpportunityDecisionValue = 'dismissed' | 'planned';

export interface OpportunityDecision {
  book_id: string;
  opportunity_key: string;
  decision: OpportunityDecisionValue;
}

export interface Opportunity {
  bookId: string;
  bookTitle: string;
  /** Stable identifier used for dismissals, e.g. 'translation:de', 'audiobook'. */
  key: string;
  kind: OpportunityKind;
  label: string;
  score: number;
  href: string;
  /** Set when the user has made a call on this suggestion. Dismissed items
      score 0; planned items keep their score (they're accepted work). */
  decision: OpportunityDecisionValue | null;
}

/** Minimal slice of an audiobook project the engine needs. */
export interface AudiobookProjectLite {
  book_id: string | null;
  status: string;
}

// Base scores order the kinds by typical revenue impact (audiobook >
// translation > format > KDP > ARC). Series membership boosts everything —
// a gap in a selling series compounds across the series.
const BASE_SCORE: Record<OpportunityKind, number> = {
  audiobook: 50,
  translation: 40,
  format: 30,
  kdp: 20,
  arc: 10,
};

// Only propose translations into languages Melissa's catalog has actually
// published in; never-used languages rank far below (they'd otherwise nag
// about 16 languages per book — the §3 "opportunity fatigue" failure mode).
const NEVER_USED_LANGUAGE_PENALTY = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

function seriesBoost(book: Book, books: Book[]): number {
  if (!book.series) return 0;
  const size = books.filter(b => b.series === book.series && !b.parent_book_id).length;
  return Math.min(size, 5) * 2;
}

export function deriveOpportunities(
  books: Book[],
  audiobookProjects: AudiobookProjectLite[],
  decisions: OpportunityDecision[],
  now: Date = new Date(),
): Opportunity[] {
  const decisionByKey = new Map(decisions.map(d => [`${d.book_id}|${d.opportunity_key}`, d.decision]));
  const projectsByBook = new Map<string, AudiobookProjectLite[]>();
  for (const p of audiobookProjects) {
    if (!p.book_id) continue;
    const list = projectsByBook.get(p.book_id) ?? [];
    list.push(p);
    projectsByBook.set(p.book_id, list);
  }

  // Languages the catalog already publishes in (via translation children or
  // explicitly-tagged books). Used to rank proposals.
  const usedLanguages = new Set(
    books.map(b => b.language).filter((l): l is string => !!l && l !== 'en'),
  );
  const childrenByParent = new Map<string, Book[]>();
  for (const b of books) {
    if (!b.parent_book_id) continue;
    const list = childrenByParent.get(b.parent_book_id) ?? [];
    list.push(b);
    childrenByParent.set(b.parent_book_id, list);
  }

  const out: Opportunity[] = [];
  const push = (book: Book, key: string, kind: OpportunityKind, label: string, href: string, scoreAdj = 0) => {
    const decision = decisionByKey.get(`${book.id}|${key}`) ?? null;
    const score = decision === 'dismissed'
      ? 0
      : Math.max(1, BASE_SCORE[kind] + seriesBoost(book, books) + scoreAdj);
    out.push({ bookId: book.id, bookTitle: book.title, key, kind, label, score, href, decision });
  };

  // Originals only: translations inherit their parent's opportunity surface.
  const originals = books.filter(b => !b.parent_book_id);

  for (const book of originals) {
    if (book.status !== 'published') continue;
    const children = childrenByParent.get(book.id) ?? [];
    const childLanguages = new Set(children.map(c => c.language).filter(Boolean));

    // Translation gaps — one per candidate language.
    for (const { code } of TRANSLATION_LANGUAGES) {
      if (childLanguages.has(code)) continue;
      push(
        book,
        `translation:${code}`,
        'translation',
        `Translate “${book.title}” into ${languageLabel(code)}`,
        '/catalog',
        usedLanguages.has(code) ? 0 : -NEVER_USED_LANGUAGE_PENALTY,
      );
    }

    // Audiobook gap: no audiobook ISBN and no project for the book.
    const hasAudiobookProject = (projectsByBook.get(book.id) ?? []).length > 0;
    if (!book.isbn_audiobook && !hasAudiobookProject) {
      push(book, 'audiobook', 'audiobook', `Make the audiobook for “${book.title}”`, '/audiobook');
    }

    // Format gaps: published but a print format has no price set.
    if (book.paperback_price == null) {
      push(book, 'format:paperback', 'format', `“${book.title}” has no paperback price`, '/catalog');
    }
    if (book.hardcover_price == null) {
      push(book, 'format:hardcover', 'format', `“${book.title}” has no hardcover price`, '/catalog');
    }

    // KDP gap: published with an empty Amazon keyword box.
    if (!book.amazon_keywords || book.amazon_keywords.length === 0) {
      push(book, 'kdp', 'kdp', `“${book.title}” has no Amazon keywords`, '/kdp-optimizer');
    }

    // ARC gap: recently published but excluded from ARC applications.
    if (!book.include_in_arcs && book.publish_date) {
      const published = new Date(book.publish_date + 'T00:00:00');
      const ageDays = (now.getTime() - published.getTime()) / DAY_MS;
      if (ageDays >= 0 && ageDays <= 60) {
        push(book, 'arc', 'arc', `“${book.title}” isn't taking ARC applications`, '/arcs');
      }
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Pipeline completeness (directive §3.3): a weighted 0–100 "how far along is
// this book" percent for progress bars on Home and the Catalog checklist.
// Weighted stages, cumulative through the publishing pipeline.

export function pipelinePercent(
  book: Book,
  manuscript: Manuscript | null | undefined,
  audiobookProjects: AudiobookProjectLite[],
  decisions: OpportunityDecision[] = [],
): number {
  let pct = 0;

  if (manuscript) pct += 10;

  // Draft complete: the manuscript has moved past drafting, or the word
  // target is met (book-level word_count is the fallback when the Writing
  // module isn't in use for this book).
  const words = manuscript?.word_count ?? book.word_count ?? 0;
  const target = manuscript?.target_word_count ?? book.target_word_count ?? null;
  const draftComplete =
    (manuscript && manuscript.status !== 'draft') ||
    (target != null && target > 0 && words >= target) ||
    ['editing', 'pre_order', 'published'].includes(book.status);
  if (draftComplete) pct += 25;

  if (['editing', 'pre_order', 'published'].includes(book.status)) pct += 20;
  if (['pre_order', 'published'].includes(book.status)) pct += 15;
  if (book.status === 'published') pct += 15;

  if (book.paperback_price != null || book.hardcover_price != null) pct += 10;

  const audiobookDone =
    !!book.isbn_audiobook ||
    audiobookProjects.some(p => p.book_id === book.id && p.status === 'complete');
  const audiobookDismissed = decisions.some(
    d => d.book_id === book.id && d.opportunity_key === 'audiobook' && d.decision === 'dismissed',
  );
  if (audiobookDone || audiobookDismissed) pct += 5;

  return Math.max(0, Math.min(100, pct));
}
