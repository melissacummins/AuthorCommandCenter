-- ============================================
-- Media AI Generator
--   Stores prompts, results, and metadata for AI-generated images and
--   videos (via Fal.AI). Adds collections for organising history,
--   style presets to prepend brand-voice snippets to prompts, and a
--   monthly spend cap so a runaway loop can't drain the Fal balance.
--
--   Per CLAUDE.md: every statement is idempotent so Supabase preview
--   branching can re-apply this migration without failing.
-- ============================================

-- ============================================
-- COLLECTIONS — user-defined buckets ("Pinterest", "New Release")
-- ============================================
CREATE TABLE IF NOT EXISTS media_collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_collections_user_idx
  ON media_collections(user_id, created_at DESC);

ALTER TABLE media_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Media collections: owner read" ON media_collections;
CREATE POLICY "Media collections: owner read"
ON media_collections FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media collections: owner write" ON media_collections;
CREATE POLICY "Media collections: owner write"
ON media_collections FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media collections: owner update" ON media_collections;
CREATE POLICY "Media collections: owner update"
ON media_collections FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media collections: owner delete" ON media_collections;
CREATE POLICY "Media collections: owner delete"
ON media_collections FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- STYLE PRESETS — saved prompt snippets to prepend
-- ============================================
CREATE TABLE IF NOT EXISTS media_style_presets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  prompt_snippet TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_style_presets_user_idx
  ON media_style_presets(user_id, created_at DESC);

ALTER TABLE media_style_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Media style presets: owner read" ON media_style_presets;
CREATE POLICY "Media style presets: owner read"
ON media_style_presets FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media style presets: owner write" ON media_style_presets;
CREATE POLICY "Media style presets: owner write"
ON media_style_presets FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media style presets: owner update" ON media_style_presets;
CREATE POLICY "Media style presets: owner update"
ON media_style_presets FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media style presets: owner delete" ON media_style_presets;
CREATE POLICY "Media style presets: owner delete"
ON media_style_presets FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- GENERATIONS — one row per attempted generation
-- ============================================
CREATE TABLE IF NOT EXISTS media_generations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  collection_id UUID REFERENCES media_collections(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  full_prompt TEXT NOT NULL,
  style_preset_id UUID REFERENCES media_style_presets(id) ON DELETE SET NULL,
  width INTEGER,
  height INTEGER,
  duration_seconds INTEGER,
  source_image_url TEXT,
  output_url TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  fal_request_id TEXT,
  fal_model_endpoint TEXT,
  cost_cents INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS media_generations_user_idx
  ON media_generations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_generations_collection_idx
  ON media_generations(collection_id) WHERE collection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_generations_pending_idx
  ON media_generations(user_id, fal_request_id) WHERE status = 'pending';

ALTER TABLE media_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Media generations: owner read" ON media_generations;
CREATE POLICY "Media generations: owner read"
ON media_generations FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media generations: owner write" ON media_generations;
CREATE POLICY "Media generations: owner write"
ON media_generations FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media generations: owner update" ON media_generations;
CREATE POLICY "Media generations: owner update"
ON media_generations FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media generations: owner delete" ON media_generations;
CREATE POLICY "Media generations: owner delete"
ON media_generations FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- SETTINGS — monthly spend cap per user
-- ============================================
CREATE TABLE IF NOT EXISTS media_settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  monthly_cap_cents INTEGER NOT NULL DEFAULT 2000,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE media_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Media settings: owner read" ON media_settings;
CREATE POLICY "Media settings: owner read"
ON media_settings FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media settings: owner write" ON media_settings;
CREATE POLICY "Media settings: owner write"
ON media_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media settings: owner update" ON media_settings;
CREATE POLICY "Media settings: owner update"
ON media_settings FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- STORAGE — outputs are public so the URL can be shared / embedded,
--   inputs (uploads for image editing) stay private.
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-outputs',
  'media-outputs',
  TRUE,
  104857600, -- 100MB (video can be big)
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-inputs',
  'media-inputs',
  FALSE,
  20971520, -- 20MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- media-outputs policies
DROP POLICY IF EXISTS "Media outputs: public read" ON storage.objects;
CREATE POLICY "Media outputs: public read"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'media-outputs');

DROP POLICY IF EXISTS "Media outputs: users upload own folder" ON storage.objects;
CREATE POLICY "Media outputs: users upload own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'media-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Media outputs: users update own folder" ON storage.objects;
CREATE POLICY "Media outputs: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'media-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Media outputs: users delete own folder" ON storage.objects;
CREATE POLICY "Media outputs: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'media-outputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- media-inputs policies (private — owner only)
DROP POLICY IF EXISTS "Media inputs: owner read" ON storage.objects;
CREATE POLICY "Media inputs: owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'media-inputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Media inputs: users upload own folder" ON storage.objects;
CREATE POLICY "Media inputs: users upload own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'media-inputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Media inputs: users delete own folder" ON storage.objects;
CREATE POLICY "Media inputs: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'media-inputs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
