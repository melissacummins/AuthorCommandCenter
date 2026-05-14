export type ScoreColor = 'Red' | 'Yellow' | 'Green' | 'Gray';

export interface Trope {
  id: string;
  user_id: string;
  name: string;
  description: string;
  external_id: string | null;
  created_at: string;
}

export interface Keyword {
  id: string;
  user_id: string;
  text: string;
  trope_id: string;
  external_id: string | null;
  search_volume: number;
  search_volume_color: ScoreColor | '';
  competitive_score: number;
  competitive_score_color: ScoreColor | '';
  competitors: number;
  avg_pages: number;
  avg_price: number;
  avg_monthly_earnings: number;
  last_updated: number | null;
  created_at: string;
}

export interface KdpBook {
  id: string;
  user_id: string;
  book_id: string | null;
  external_id: string | null;
  title: string;
  subtitle: string | null;
  series: string;
  amazon_categories: string;
  assigned_trope_ids: string[];
  selected_keyword_ids: string[];
  created_at: string;
  updated_at: string;
}

// JSON import shape — matches the user's existing dataset.
export interface ImportJson {
  books: {
    id: string;
    title: string;
    subtitle?: string;
    series?: string;
    amazonCategories?: string;
    assignedTropeIds?: string[];
    selectedKeywordIds?: string[];
  }[];
  tropes: {
    id: string;
    name: string;
    description?: string;
  }[];
  keywords: {
    id: string;
    tropeId: string;
    text: string;
    searchVolume?: number;
    searchVolumeColor?: ScoreColor | '';
    competitiveScore?: number;
    competitiveScoreColor?: ScoreColor | '';
    competitors?: number;
    avgPages?: number;
    avgPrice?: number;
    avgMonthlyEarnings?: number;
    lastUpdated?: number;
  }[];
}

export interface ImportSummary {
  tropes: { inserted: number; updated: number };
  keywords: { inserted: number; updated: number };
  books: { inserted: number; updated: number };
}

export const COLOR_CLASSES: Record<ScoreColor, string> = {
  Green: 'bg-emerald-100 text-emerald-800',
  Yellow: 'bg-amber-100 text-amber-800',
  Red: 'bg-rose-100 text-rose-800',
  Gray: 'bg-slate-100 text-slate-600',
};
