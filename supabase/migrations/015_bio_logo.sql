-- ============================================
-- Bio page branding: logo upload
--   Adds bio_settings table for per-user bio page customization
--   and a Supabase Storage bucket for uploaded logos with per-user
--   folder isolation enforced via RLS.
-- Run this in your Supabase SQL Editor.
-- ============================================

CREATE TABLE IF NOT EXISTS bio_settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  logo_url   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bio_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own bio settings" ON bio_settings;
CREATE POLICY "Users read own bio settings"
ON bio_settings FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own bio settings" ON bio_settings;
CREATE POLICY "Users insert own bio settings"
ON bio_settings FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own bio settings" ON bio_settings;
CREATE POLICY "Users update own bio settings"
ON bio_settings FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own bio settings" ON bio_settings;
CREATE POLICY "Users delete own bio settings"
ON bio_settings FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Storage bucket for bio assets (logos and any future bio-page imagery).
-- Public read so the public bio page can render images without auth.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bio-assets',
  'bio-assets',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies: each user's files live under <user_id>/... and only
-- they can write to that folder. Public can read everything in the bucket.
DROP POLICY IF EXISTS "Bio assets: public read" ON storage.objects;
CREATE POLICY "Bio assets: public read"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'bio-assets');

DROP POLICY IF EXISTS "Bio assets: users upload own folder" ON storage.objects;
CREATE POLICY "Bio assets: users upload own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'bio-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Bio assets: users update own folder" ON storage.objects;
CREATE POLICY "Bio assets: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'bio-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Bio assets: users delete own folder" ON storage.objects;
CREATE POLICY "Bio assets: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'bio-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
