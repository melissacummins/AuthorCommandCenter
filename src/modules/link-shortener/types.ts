export interface ShortLink {
  id: string;
  user_id: string;
  parent_id: string | null;
  slug: string;
  label: string;
  destination_url: string;
  channel: string;
  notes: string;
  tags: string[];
  is_active: boolean;
  archived_at: string | null;
  click_count: number;
  last_clicked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkClick {
  id: string;
  link_id: string;
  user_id: string;
  slug: string;
  channel: string;
  destination_url: string;
  referrer: string;
  user_agent: string;
  device_type: string;
  browser: string;
  os: string;
  country: string;
  region: string;
  city: string;
  ip_hash: string;
  language: string;
  is_bot: boolean;
  clicked_at: string;
}

export type ShortLinkInsert = Pick<
  ShortLink,
  'slug' | 'label' | 'destination_url' | 'channel' | 'notes' | 'tags' | 'is_active'
> & { parent_id?: string | null };

export type ShortLinkUpdate = Partial<
  Pick<ShortLink, 'label' | 'destination_url' | 'channel' | 'notes' | 'tags' | 'is_active' | 'archived_at'>
>;
