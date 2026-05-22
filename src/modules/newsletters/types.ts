export interface NewsletterEventBookLink {
  book_id: string;
  book_title: string;
  pen_name_id: string | null;
}

export interface NewsletterEvent {
  id: string;
  user_id: string;
  klaviyo_campaign_id: string | null;
  subject: string;
  sent_at: string;
  sent_count: number;
  open_count: number;
  click_count: number;
  unsubscribe_count: number;
  metrics_refreshed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined attribution rows projected for list/detail views.
  // Populated by listNewsletterEvents().
  books?: NewsletterEventBookLink[];
}

export interface NewsletterEventInsert {
  klaviyo_campaign_id?: string | null;
  subject: string;
  sent_at: string;
  sent_count?: number;
  open_count?: number;
  click_count?: number;
  unsubscribe_count?: number;
  metrics_refreshed_at?: string | null;
  notes?: string | null;
  book_ids: string[];
}

export type NewsletterEventUpdate = Partial<Omit<NewsletterEventInsert, 'book_ids'>> & {
  book_ids?: string[];
};

// Open rate as a percentage, or null when sent_count is 0. Same shape
// for click and unsubscribe rates so the UI can format them uniformly.
export function openRate(ev: NewsletterEvent): number | null {
  return ev.sent_count > 0 ? (ev.open_count / ev.sent_count) * 100 : null;
}
export function clickRate(ev: NewsletterEvent): number | null {
  return ev.sent_count > 0 ? (ev.click_count / ev.sent_count) * 100 : null;
}
