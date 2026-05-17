import type { MediaKind } from './models';

export interface MediaGeneration {
  id: string;
  user_id: string;
  collection_id: string | null;
  kind: MediaKind;
  model: string;
  prompt: string;
  full_prompt: string;
  style_preset_id: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  source_image_url: string | null;
  output_url: string | null;
  thumbnail_url: string | null;
  status: 'pending' | 'completed' | 'failed';
  fal_request_id: string | null;
  fal_model_endpoint: string | null;
  cost_cents: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface MediaCollection {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface MediaStylePreset {
  id: string;
  user_id: string;
  name: string;
  prompt_snippet: string;
  created_at: string;
}

export interface MediaSettings {
  user_id: string;
  monthly_cap_cents: number;
  updated_at: string;
}

export interface MediaCustomModel {
  id: string;
  user_id: string;
  label: string;
  endpoint: string;
  kind: 'image' | 'video';
  is_async: boolean;
  accepts_input_image: boolean;
  supports_custom_size: boolean;
  estimated_cost_cents: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}
