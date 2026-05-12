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

export const STATUS_COLORS: Record<BookStatus, string> = {
  idea: 'bg-slate-100 text-slate-700',
  drafting: 'bg-amber-100 text-amber-800',
  editing: 'bg-blue-100 text-blue-800',
  pre_order: 'bg-purple-100 text-purple-800',
  published: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-rose-100 text-rose-800',
};
