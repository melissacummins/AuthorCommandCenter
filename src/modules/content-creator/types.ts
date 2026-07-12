// Content Creator data shapes — mirrors migration 100_content_creator.sql.

export type HookStatus = 'candidate' | 'approved' | 'archived';
export type HookSource = 'scan' | 'manual';

export interface ContentHook {
  id: string;
  user_id: string;
  book_id: string | null;
  manuscript_id: string | null;
  hook_text: string;
  scene_excerpt: string;
  rationale: string;
  tags: string[];
  status: HookStatus;
  favorite: boolean;
  source: HookSource;
  created_at: string;
  updated_at: string;
}

export type ScanStatus = 'running' | 'done' | 'cancelled';

// A raw per-chapter moment accumulated in content_scans.candidates while the
// scan runs. Extraction only LOCATES (plain factual moment + verbatim
// excerpt); the rank pass writes the actual hooks from these on the stronger
// model, and a verify pass fact-checks each survivor against its excerpt.
export interface HookCandidate {
  moment: string;
  scene_excerpt: string;
  tags: string[];
}

// A written hook coming out of the rank pass, pre-verification.
export interface WrittenHook {
  hook_text: string;
  scene_excerpt: string;
  rationale: string;
  tags: string[];
}

export interface ContentScan {
  id: string;
  user_id: string;
  manuscript_id: string;
  status: ScanStatus;
  scanned_chapter_ids: string[];
  candidates: HookCandidate[];
  model_used: string;
  created_at: string;
  updated_at: string;
}

export interface PlaybookEntry {
  id: string;
  user_id: string;
  title: string;
  pattern_text: string;
  example_text: string;
  tags: string[];
  pen_name_id: string | null;
  formats: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type PlaybookEntryInsert = Omit<PlaybookEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export type RuleType = 'style' | 'avatar' | 'banned_word';

export interface PlaybookRule {
  id: string;
  user_id: string;
  rule_type: RuleType;
  content: string;
  replacement: string | null;
  active: boolean;
  created_at: string;
}

export interface DefaultBannedWord {
  id: string;
  word: string;
  platform: 'meta' | 'tiktok' | 'both';
  note: string;
}

// The AI tasks Content Creator runs. Each has a user-configurable model in
// content_model_settings; nothing is hard-coded outside lib/models.ts.
export type AiTask = 'extract' | 'rank' | 'slides' | 'script' | 'copy' | 'image_prompt' | 'synonym' | 'catalog';

export interface ModelSetting {
  task: AiTask;
  provider: string;
  model_id: string;
}
