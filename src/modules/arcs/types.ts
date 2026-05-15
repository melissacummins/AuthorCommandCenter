export type ArcStatus =
  | 'new'
  | 'current_arc_member'
  | 'awaiting_arc'
  | 'awaiting_review'
  | 'didnt_review'
  | 'didnt_download'
  | 'on_tbr_no_review'
  | 'not_moving_forward'
  | 'special_circumstances'
  | 'insufficient_information'
  | 'not_pending_anything';

export interface ArcReader {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  primary_sm: string | null;
  ig_profile_url: string | null;
  tt_profile_url: string | null;
  threads_profile_url: string | null;
  fb_profile_url: string | null;
  goodreads_profile_url: string | null;
  amazon_reviewer_url: string | null;
  blog_url: string | null;
  status: ArcStatus;
  applied_for: string[];
  received: string[];
  reviewed: string[];
  place_to_review: string[];
  newsletter_subscribed: boolean;
  promo_team: boolean;
  notes: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ArcReaderInsert = Omit<ArcReader, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
export type ArcReaderUpdate = Partial<ArcReaderInsert>;

export const STATUS_ORDER: ArcStatus[] = [
  'new',
  'awaiting_arc',
  'current_arc_member',
  'awaiting_review',
  'didnt_review',
  'didnt_download',
  'on_tbr_no_review',
  'special_circumstances',
  'insufficient_information',
  'not_moving_forward',
  'not_pending_anything',
];

export const STATUS_LABELS: Record<ArcStatus, string> = {
  new: 'New',
  current_arc_member: 'Current ARC Member',
  awaiting_arc: 'Awaiting ARC',
  awaiting_review: 'Awaiting Review',
  didnt_review: "Didn't Review",
  didnt_download: "Didn't Download",
  on_tbr_no_review: 'On TBR, No Review',
  not_moving_forward: 'Not Moving Forward',
  special_circumstances: 'Special Circumstances',
  insufficient_information: 'Insufficient Information',
  not_pending_anything: 'Not Pending Anything',
};

export const STATUS_COLORS: Record<ArcStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  current_arc_member: 'bg-pink-100 text-pink-800',
  awaiting_arc: 'bg-amber-100 text-amber-800',
  awaiting_review: 'bg-amber-100 text-amber-800',
  didnt_review: 'bg-purple-100 text-purple-800',
  didnt_download: 'bg-orange-100 text-orange-800',
  on_tbr_no_review: 'bg-yellow-100 text-yellow-800',
  not_moving_forward: 'bg-rose-100 text-rose-800',
  special_circumstances: 'bg-violet-100 text-violet-800',
  insufficient_information: 'bg-slate-100 text-slate-700',
  not_pending_anything: 'bg-slate-100 text-slate-600',
};

export const NOTION_STATUS_MAP: Record<string, ArcStatus> = {
  'Current ARC Member': 'current_arc_member',
  "Didn't Review": 'didnt_review',
  'Awaiting Review': 'awaiting_review',
  'Special circumstances': 'special_circumstances',
  "Didn't download": 'didnt_download',
  'Awaiting ARC': 'awaiting_arc',
  'Not moving forward': 'not_moving_forward',
  'On TBR no review': 'on_tbr_no_review',
  New: 'new',
  'Insufficient information': 'insufficient_information',
  'Not Pending Anything': 'not_pending_anything',
};

export const PLACES = [
  'Amazon',
  'Apple',
  'B&N',
  'Goodreads',
  'Google Play',
  'Kobo',
  'Social Media',
  'Bookbub',
  'Your Blog',
  'Smashwords',
  'Storygraph',
  'Podcast (or other media outlet)',
  'Other',
] as const;
