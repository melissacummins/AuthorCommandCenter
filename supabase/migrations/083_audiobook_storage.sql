-- ============================================
-- Audiobook: rendered audio storage
--   Private bucket (unlike book-covers which is public) — finished
--   narration is the user's product, so clips are reached only through
--   short-lived signed URLs minted server/client-side. Per-user folder
--   isolation enforced via RLS, same shape as media-inputs.
--
--   Layout: audiobook-audio/<user_id>/<project_id>/<segment_id>.mp3
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audiobook-audio',
  'audiobook-audio',
  FALSE,
  52428800, -- 50MB per clip
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Audiobook audio: users read own folder" ON storage.objects;
CREATE POLICY "Audiobook audio: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'audiobook-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Audiobook audio: users upload own folder" ON storage.objects;
CREATE POLICY "Audiobook audio: users upload own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'audiobook-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Audiobook audio: users update own folder" ON storage.objects;
CREATE POLICY "Audiobook audio: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'audiobook-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Audiobook audio: users delete own folder" ON storage.objects;
CREATE POLICY "Audiobook audio: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'audiobook-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
