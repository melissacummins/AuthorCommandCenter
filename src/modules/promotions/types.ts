// Curated list of promo kinds. Keep in sync with the CHECK constraint
// in migration 032. Adding a new kind requires a migration that
// extends the CHECK list.
export const PROMO_KINDS = [
  'bookbub_featured',
  'bookbub_deal',
  'freebooksy',
  'fussy_librarian',
  'ereader_news_today',
  'free_run',
  'kindle_countdown',
  'newsletter_swap',
  'amazon_ad',
  'facebook_ad',
  'tiktok_ad',
  'group_promo',
  'other',
] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const PROMO_LABELS: Record<PromoKind, string> = {
  bookbub_featured:    'BookBub Featured Deal',
  bookbub_deal:        'BookBub Daily Deal',
  freebooksy:          'Freebooksy',
  fussy_librarian:     'Fussy Librarian',
  ereader_news_today:  'eReader News Today',
  free_run:            'Free run (KDP Select)',
  kindle_countdown:    'Kindle Countdown',
  newsletter_swap:     'Newsletter swap',
  amazon_ad:           'Amazon Ad',
  facebook_ad:         'Facebook Ad',
  tiktok_ad:           'TikTok Ad',
  group_promo:         'Group promo',
  other:               'Other',
};

// Tailwind color classes for the Timeline event dot + chip backgrounds.
// Promos color by family — free things in cyan, ad spend in orange,
// newsletter-style outreach in pink.
export const PROMO_COLORS: Record<PromoKind, { bg: string; text: string; dot: string }> = {
  bookbub_featured:    { bg: 'bg-pink-50',    text: 'text-pink-700',    dot: 'bg-pink-500'    },
  bookbub_deal:        { bg: 'bg-pink-50',    text: 'text-pink-700',    dot: 'bg-pink-500'    },
  freebooksy:          { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500'    },
  fussy_librarian:     { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500'    },
  ereader_news_today:  { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500'    },
  free_run:            { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500'  },
  kindle_countdown:    { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500'  },
  newsletter_swap:     { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  amazon_ad:           { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500'  },
  facebook_ad:         { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500'  },
  tiktok_ad:           { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500'  },
  group_promo:         { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  other:               { bg: 'bg-slate-100',  text: 'text-slate-700',   dot: 'bg-slate-500'   },
};

export interface Promotion {
  id: string;
  user_id: string;
  book_id: string;
  kind: PromoKind;
  name: string;
  starts_on: string;
  ends_on: string;
  cost: number | null;
  revenue: number | null;
  free_downloads: number | null;
  units_sold: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Lightweight join used by the list view to avoid a second lookup.
  // Populated by listPromotions().
  book_title?: string;
  book_pen_name_id?: string | null;
}

export interface PromotionInsert {
  book_id: string;
  kind: PromoKind;
  name: string;
  starts_on: string;
  ends_on: string;
  cost?: number | null;
  revenue?: number | null;
  free_downloads?: number | null;
  units_sold?: number | null;
  notes?: string | null;
}
export type PromotionUpdate = Partial<PromotionInsert>;
