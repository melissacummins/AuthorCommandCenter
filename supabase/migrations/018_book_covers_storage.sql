-- ============================================
-- Catalog: book cover image storage
--   Adds a Supabase Storage bucket for per-book cover images with
--   per-user folder isolation enforced via RLS. Same shape as the
--   bio-assets bucket.
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'book-covers',
  'book-covers',
  TRUE,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Book covers: public read" ON storage.objects;
CREATE POLICY "Book covers: public read"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'book-covers');

DROP POLICY IF EXISTS "Book covers: users upload own folder" ON storage.objects;
CREATE POLICY "Book covers: users upload own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'book-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Book covers: users update own folder" ON storage.objects;
CREATE POLICY "Book covers: users update own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'book-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Book covers: users delete own folder" ON storage.objects;
CREATE POLICY "Book covers: users delete own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'book-covers'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
