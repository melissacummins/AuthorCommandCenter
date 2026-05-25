export interface ShortLink {
  id: string;
  user_id: string;
  parent_id: string | null;
  folder_id: string | null;
  slug: string;
  label: string;
  destination_url: string;
  channel: string;
  notes: string;
  tags: string[];
  is_active: boolean;
  archived_at: string | null;
  starts_at: string | null;
  expires_at: string | null;
  expired_redirect_url: string | null;
  show_on_bio: boolean;
  bio_sort_order: number;
  bio_title: string;
  bio_style: 'card' | 'icon';
  bio_featured: boolean;
  thumbnail_url: string | null;
  click_count: number;
  non_bot_click_count: number;
  conversion_count: number;
  conversion_value: number;
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
  click_id: string | null;
  clicked_at: string;
}

export interface LinkFolder {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ConversionSource = 'manual' | 'shopify_webhook' | 'shopify_clickid' | 'api';

export interface LinkConversion {
  id: string;
  link_id: string;
  user_id: string;
  click_id: string | null;
  click_row_id: string | null;
  source: ConversionSource;
  external_ref: string | null;
  value: number;
  currency: string;
  notes: string;
  occurred_at: string;
  created_at: string;
}

export interface AttributionSettings {
  user_id: string;
  shopify_webhook_secret: string | null;
  click_id_param: string;
  attribution_window_minutes: number;
  last_webhook_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BioSettings {
  user_id: string;
  logo_url: string | null;
  bio_title: string | null;
  bio_subtitle: string | null;
  theme: string | null;
  accent_color: string | null;
  meta_pixel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LandingPage {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_url: string | null;
  source_url: string;
  buttons: BioButton[];
  theme: string | null;
  accent_color: string | null;
  created_at: string;
  updated_at: string;
}

export type LandingPageInsert = {
  slug: string;
  title?: string;
  description?: string;
  cover_image_url?: string | null;
  source_url?: string;
  buttons?: BioButton[];
  theme?: string;
  accent_color?: string | null;
};

export type LandingPageUpdate = Partial<Omit<LandingPageInsert, 'slug'>> & { slug?: string };

export interface BioView {
  id: string;
  user_id: string;
  referrer: string;
  device_type: string;
  country: string;
  is_bot: boolean;
  viewed_at: string;
}

export interface CustomDomain {
  id: string;
  user_id: string;
  domain: string;
  verified: boolean;
  is_primary: boolean;
  verification_token: string;
  created_at: string;
  updated_at: string;
}

export type BioBlockType = 'section' | 'image' | 'buttons' | 'email';

export interface BioButton {
  label: string;
  url: string;
}

export interface BioBlock {
  id: string;
  user_id: string;
  type: BioBlockType;
  title: string | null;
  body: string | null;
  image_url: string | null;
  link_url: string | null;
  buttons: BioButton[];
  klaviyo_list_id: string | null;
  button_label: string | null;
  bio_sort_order: number;
  created_at: string;
  updated_at: string;
}

export type BioBlockInsert = {
  type: BioBlockType;
  title?: string | null;
  body?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  buttons?: BioButton[];
  klaviyo_list_id?: string | null;
  button_label?: string | null;
  bio_sort_order?: number;
};

export type BioBlockUpdate = Partial<
  Pick<BioBlock, 'title' | 'body' | 'image_url' | 'link_url' | 'buttons' | 'klaviyo_list_id' | 'button_label' | 'bio_sort_order'>
>;

export type ShortLinkInsert = Pick<
  ShortLink,
  'slug' | 'label' | 'destination_url' | 'channel' | 'notes' | 'tags' | 'is_active'
> & {
  parent_id?: string | null;
  folder_id?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  expired_redirect_url?: string | null;
  show_on_bio?: boolean;
  bio_title?: string;
  bio_style?: 'card' | 'icon';
  bio_sort_order?: number;
  thumbnail_url?: string | null;
};

export type ShortLinkUpdate = Partial<
  Pick<
    ShortLink,
    'label' | 'destination_url' | 'channel' | 'notes' | 'tags' | 'is_active' | 'archived_at'
    | 'folder_id' | 'starts_at' | 'expires_at' | 'expired_redirect_url'
    | 'show_on_bio' | 'bio_title' | 'bio_style' | 'bio_featured' | 'bio_sort_order' | 'thumbnail_url'
  >
>;

export type ConversionInsert = Pick<LinkConversion, 'link_id'> & {
  source?: ConversionSource;
  value?: number;
  currency?: string;
  notes?: string;
  external_ref?: string | null;
  click_id?: string | null;
  occurred_at?: string;
};
