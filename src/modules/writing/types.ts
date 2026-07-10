export type ManuscriptStatus = 'draft' | 'revising' | 'final';

export interface Manuscript {
  id: string;
  user_id: string;
  book_id: string | null;
  title: string;
  status: ManuscriptStatus;
  source_filename: string | null;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export type ManuscriptInsert = {
  title: string;
  book_id?: string | null;
  status?: ManuscriptStatus;
  source_filename?: string | null;
  word_count?: number;
};

export type ManuscriptUpdate = Partial<Omit<Manuscript, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export interface ManuscriptChapter {
  id: string;
  manuscript_id: string;
  user_id: string;
  idx: number;
  title: string;
  content_html: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

// A scanned-but-not-yet-saved chapter — the breakdown the user reviews and
// adjusts (merge, rename, delete) before accepting during import.
export interface ChapterDraft {
  title: string;
  content_html: string;
}

// A saved snapshot of a chapter's content — either an hourly autosave taken
// while editing, or a user-labeled manual snapshot. Restoring one snapshots
// the chapter's current content first, so a restore is itself reversible.
export interface ManuscriptRevision {
  id: string;
  chapter_id: string;
  user_id: string;
  content_html: string;
  word_count: number;
  label: string | null;
  created_at: string;
}

export const STATUS_LABELS: Record<ManuscriptStatus, string> = {
  draft: 'Draft',
  revising: 'Revising',
  final: 'Final',
};

export const STATUS_COLORS: Record<ManuscriptStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  revising: 'bg-amber-100 text-amber-800',
  final: 'bg-emerald-100 text-emerald-800',
};

// Word count from HTML content — strip tags, count whitespace-delimited runs.
// Used both client-side (live counts while reviewing) and before every save
// so `manuscripts.word_count` / `manuscript_chapters.word_count` stay accurate.
export function countWords(html: string): number {
  const text = (html ?? '').replace(/<[^>]+>/g, ' ');
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

// Strip HTML tags down to plain text, collapsing whitespace. Used by the
// cross-module plain-text API so other modules never have to deal with markup.
export function htmlToPlainText(html: string): string {
  const text = (html ?? '')
    .replace(/<(p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
