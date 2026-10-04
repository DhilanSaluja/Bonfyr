-- Profile bio + public media storage for avatars and crew photos

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

UPDATE profiles
SET bio = COALESCE(bio, '')
WHERE bio IS NULL;

-- Storage buckets (public read; authenticated users upload to their own paths)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
  ),
  (
    'crew-photos',
    'crew-photos',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
  )
ON CONFLICT (id) DO NOTHING;

-- Avatars: anyone can read; users manage files under their user id folder
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Crew photos: public read; owners upload under their user id folder
DROP POLICY IF EXISTS "Crew photos are publicly accessible" ON storage.objects;
CREATE POLICY "Crew photos are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-photos');

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
