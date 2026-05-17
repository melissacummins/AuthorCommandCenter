-- ============================================
-- Media: per-user custom Fal.AI models
--   When Fal launches a new model the user can add it from the UI
--   without waiting for a code change. They paste the endpoint
--   (e.g. `fal-ai/flux-pro/v1.1`), tag it image vs video, declare
--   whether it accepts an input image and whether it supports custom
--   sizes, set an estimated cost, and it shows up in their model
--   dropdown alongside the curated catalogue.
--
--   Per CLAUDE.md: idempotent so Supabase Preview Branching can
--   re-apply it without failing.
-- ============================================

CREATE TABLE IF NOT EXISTS media_custom_models (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  label TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  is_async BOOLEAN NOT NULL DEFAULT FALSE,
  accepts_input_image BOOLEAN NOT NULL DEFAULT FALSE,
  supports_custom_size BOOLEAN NOT NULL DEFAULT TRUE,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 5,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Guardrail: only fal-ai/* endpoints. Stops users from accidentally
  -- (or otherwise) pointing the server at arbitrary URLs.
  CONSTRAINT media_custom_models_endpoint_prefix CHECK (endpoint LIKE 'fal-ai/%')
);

CREATE INDEX IF NOT EXISTS media_custom_models_user_idx
  ON media_custom_models(user_id, created_at DESC);

ALTER TABLE media_custom_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Media custom models: owner read" ON media_custom_models;
CREATE POLICY "Media custom models: owner read"
ON media_custom_models FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media custom models: owner insert" ON media_custom_models;
CREATE POLICY "Media custom models: owner insert"
ON media_custom_models FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media custom models: owner update" ON media_custom_models;
CREATE POLICY "Media custom models: owner update"
ON media_custom_models FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Media custom models: owner delete" ON media_custom_models;
CREATE POLICY "Media custom models: owner delete"
ON media_custom_models FOR DELETE USING (auth.uid() = user_id);
