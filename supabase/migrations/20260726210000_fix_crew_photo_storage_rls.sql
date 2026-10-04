-- Fix crew-photo uploads.
-- Querying public.circles from storage.objects RLS fails under the caller's
-- table RLS. Store under the owner's user-id folder (same pattern as avatars)
-- and gate with auth.uid(); circles.photo_url updates still require ownership.

DROP POLICY IF EXISTS "Owners can upload crew photos" ON storage.objects;
CREATE POLICY "Owners can upload crew photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crew-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners can update crew photos" ON storage.objects;
CREATE POLICY "Owners can update crew photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crew-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'crew-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners can delete crew photos" ON storage.objects;
CREATE POLICY "Owners can delete crew photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'crew-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
