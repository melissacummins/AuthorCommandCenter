export type SocialPlatform = 'pinterest' | 'instagram' | 'facebook' | 'threads' | 'tiktok';

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: SocialPlatform;
  external_account_id: string;
  username: string | null;
  display_name: string | null;
  profile_image_url: string | null;
  scopes: string[];
  connected_at: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
}

export interface SocialPost {
  id: string;
  user_id: string;
  account_id: string;
  platform: SocialPlatform;
  external_post_id: string;
  posted_at: string | null;
  permalink: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  outbound_clicks: number | null;
  video_views: number | null;
  engagement: number | null;
  raw_metrics: Record<string, number> | null;
  book_id: string | null;
  synced_at: string;
}

export interface BookOption {
  id: string;
  title: string;
  series: string | null;
  cover_url: string | null;
}
