-- Fix crew cover uploads: storage path checks + owner-only photo RPC.
-- "new row violates row-level security policy" was hit on storage upsert
-- and/or circles.photo_url updates under strict RLS.

-- ── Storage: crew-photos ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Crew photos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Owners can upload crew photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update crew photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete crew photos" ON storage.objects;

CREATE POLICY "Crew photos are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-photos');

-- Path must start with the caller's user id: {uid}/{circleId}/...
CREATE POLICY "Owners can upload crew photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crew-photos'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "Owners can update crew photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crew-photos'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'crew-photos'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "Owners can delete crew photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'crew-photos'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- ── Circles: set cover via SECURITY DEFINER (owner check inside) ─────────────

CREATE OR REPLACE FUNCTION set_circle_photo(p_circle_id UUID, p_photo_url TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE circles
  SET photo_url = p_photo_url
  WHERE id = p_circle_id
    AND owner_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the Crew owner can change the cover photo';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_circle_photo(UUID, TEXT) TO authenticated;
