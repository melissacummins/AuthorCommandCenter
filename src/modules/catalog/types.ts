export type BookStatus =
  | 'idea'
  | 'drafting'
  | 'editing'
  | 'pre_order'
  | 'published'
  | 'paused';

export interface ReviewExcerpt {
  quote: string;
  source: string;
  rating?: number | null;
}

export interface Book {
  id: string;
  user_id: string;

  title: string;
  subtitle: string | null;
  series: string | null;
  series_position: number | null;
  pen_name_id: string | null;
  // Two-letter language code (ISO 639-1) when known: en, de, fr, etc.
  // null means "unknown / inherits from parent" — the default for
  // originals (which are usually English for our user).
  language: string | null;
  // When this book is a translation, points at the original. The UI
  // collapses translations under the parent in list views and shows
  // the language attribution on the detail header.
  parent_book_id: string | null;

  status: BookStatus;
  publish_date: string | null;
  pre_order_date: string | null;
  manuscript_due_date: string | null;

  ebook_price: number | null;
  paperback_price: number | null;
  hardcover_price: number | null;
  audiobook_price: number | null;

  blurb: string | null;
  content_warnings: string | null;
  kinks: string | null;
  tropes: string[];

  page_count: number | null;
  word_count: number | null;
  target_word_count: number | null;
  current_chapter: string | null;

  asin: string | null;
  isbn_ebook: string | null;
  isbn_paperback: string | null;
  isbn_audiobook: string | null;
  isbn_hardcover: string | null;

  amazon_keywords: string[];
  keywords: string[];
  bisac_categories: string[];

  reviews: ReviewExcerpt[];

  cover_url: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
}

export type BookInsert = Omit<Book, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
export type BookUpdate = Partial<BookInsert>;

export const STATUS_LABELS: Record<BookStatus, string> = {
  idea: 'Idea',
  drafting: 'Drafting',
  editing: 'Editing',
  pre_order: 'Pre-order',
  published: 'Published',
  paused: 'Paused',
};

// Languages we offer in the dropdown. Two-letter codes match what
// stores like Amazon use; the label is for the UI. 'en' isn't listed
// since the assumption is "original = English" — translations are
// what we tag explicitly.
export const TRANSLATION_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'cs', label: 'Czech' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
];

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  TRANSLATION_LANGUAGES.map(l => [l.code, l.label]),
);

export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

// Detect a translation suffix on a title (e.g. "Night Shade - GE",
// "Crowned In Blood - FR") so the UI can auto-suggest linking to a
// parent. Returns the base title and the inferred language code or
// null when nothing matches.
const SUFFIX_TO_LANG: Record<string, string> = {
  GE: 'de', DE: 'de',
  FR: 'fr',
  ES: 'es', SP: 'es',
  IT: 'it',
  PT: 'pt',
  NL: 'nl',
  PL: 'pl',
  SE: 'sv', SV: 'sv',
  DK: 'da', DA: 'da',
  NO: 'no', NB: 'no',
  FI: 'fi',
  CZ: 'cs', CS: 'cs',
  HU: 'hu',
  JP: 'ja', JA: 'ja',
  KR: 'ko', KO: 'ko',
  CN: 'zh', ZH: 'zh',
};

export function detectTranslationSuffix(title: string): { baseTitle: string; languageCode: string } | null {
  const m = title.match(/^(.+?)\s+-\s+([A-Za-z]{2,3})\s*$/);
  if (!m) return null;
  const code = SUFFIX_TO_LANG[m[2].toUpperCase()];
  if (!code) return null;
  return { baseTitle: m[1].trim(), languageCode: code };
}


export const STATUS_COLORS: Record<BookStatus, string> = {
  idea: 'bg-slate-100 text-slate-700',
  drafting: 'bg-amber-100 text-amber-800',
  editing: 'bg-blue-100 text-blue-800',
  pre_order: 'bg-purple-100 text-purple-800',
  published: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-rose-100 text-rose-800',
};
