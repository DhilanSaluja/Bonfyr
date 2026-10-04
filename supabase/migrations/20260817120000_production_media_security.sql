-- Production hardening before store launch:
-- 1) Sparks can only be created via RPC (no client insert bypass)
-- 2) Storage listing is authenticated-only (public URLs still work)
-- 3) Kindle/chat/cover URLs must be this user's own storage objects
-- 4) Contacts match requires a signed-in user
-- 5) MIME allow-list covers library/camera exports used in production

-- ── Sparks: close direct INSERT bypass of scheduling / membership gates ─────

DROP POLICY IF EXISTS "opens_insert_own" ON opens;
DROP POLICY IF EXISTS "Creators can insert opens" ON opens;

-- ── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION can_post_to_circle(p_user_id UUID, p_circle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier subscription_tier;
  v_circle_rank INTEGER;
BEGIN
  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = p_user_id;
  IF v_tier = 'pro' THEN RETURN true; END IF;

  SELECT rn INTO v_circle_rank FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
    FROM circles c
    WHERE EXISTS (
      SELECT 1 FROM circle_members cm
      WHERE cm.circle_id = c.id AND cm.user_id = p_user_id
    )
  ) ranked WHERE id = p_circle_id;

  RETURN COALESCE(v_circle_rank, 999) <= 5;
END;
$$;

REVOKE ALL ON FUNCTION can_post_to_circle(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_post_to_circle(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION match_users_by_phone_hashes(p_hashes TEXT[])
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, phone_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_hashes IS NULL OR cardinality(p_hashes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url, pp.phone_hash
  FROM profile_private pp
  JOIN profiles p ON p.id = pp.user_id
  WHERE pp.phone_hash = ANY (p_hashes)
    AND pp.phone_hash IS NOT NULL
    AND pp.user_id <> auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION match_users_by_phone_hashes(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO service_role;

-- ── Storage: public CDN GET stays; API listing requires a session ───────────

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Crew photos are publicly accessible" ON storage.objects;
CREATE POLICY "Crew photos are publicly accessible"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crew-photos');

DROP POLICY IF EXISTS "Kindle photos are publicly accessible" ON storage.objects;
CREATE POLICY "Kindle photos are publicly accessible"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crew-kindle');

UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2'
  ]
WHERE id = 'crew-kindle';

-- ── Own-storage URL checks ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION storage_url_owner_folder(p_url TEXT, p_bucket TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    split_part(
      split_part(COALESCE(p_url, ''), '/storage/v1/object/public/' || p_bucket || '/', 2),
      '/',
      1
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION set_circle_photo(p_circle_id UUID, p_photo_url TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folder TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_photo_url IS NULL OR btrim(p_photo_url) = '' THEN
    UPDATE circles
    SET photo_url = NULL
    WHERE id = p_circle_id AND owner_id = auth.uid();
  ELSE
    IF p_photo_url !~ '^https://' THEN
      RAISE EXCEPTION 'Cover photo must be an HTTPS Bonfyr upload';
    END IF;
    v_folder := storage_url_owner_folder(p_photo_url, 'crew-photos');
    IF v_folder IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'Cover photo must be uploaded by the Crew owner';
    END IF;

    UPDATE circles
    SET photo_url = p_photo_url
    WHERE id = p_circle_id
      AND owner_id = auth.uid();
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the Crew owner can change the cover photo';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_circle_photo(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION storage_url_owner_folder(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION enforce_profile_avatar()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.avatar_url IS NULL OR btrim(NEW.avatar_url) = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.avatar_url !~ '^https://' THEN
    RAISE EXCEPTION 'Avatar must be an HTTPS Bonfyr upload';
  END IF;
  IF storage_url_owner_folder(NEW.avatar_url, 'avatars') IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'Avatar must be uploaded by you';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_avatar ON profiles;
CREATE TRIGGER profiles_enforce_avatar
  BEFORE INSERT OR UPDATE OF avatar_url ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_profile_avatar();

CREATE OR REPLACE FUNCTION enforce_crew_post_media()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NEW.photo_url IS NULL OR NEW.photo_url !~ '^https://' THEN
    RAISE EXCEPTION 'Kindle media must be an HTTPS Bonfyr upload';
  END IF;
  IF storage_url_owner_folder(NEW.photo_url, 'crew-kindle') IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Kindle media must be uploaded by you';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_posts_enforce_media ON crew_posts;
CREATE TRIGGER crew_posts_enforce_media
  BEFORE INSERT ON crew_posts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_crew_post_media();

CREATE OR REPLACE FUNCTION enforce_crew_message_media()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_host TEXT;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(NEW.message_type, 'text') IN ('image', 'video') THEN
    IF NEW.media_url IS NULL OR NEW.media_url !~ '^https://' THEN
      RAISE EXCEPTION 'Chat media must be an HTTPS Bonfyr upload';
    END IF;
    IF storage_url_owner_folder(NEW.media_url, 'crew-kindle') IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'Chat media must be uploaded by you';
    END IF;
  ELSIF COALESCE(NEW.message_type, 'text') = 'gif' THEN
    IF NEW.media_url IS NULL OR NEW.media_url !~ '^https://' THEN
      RAISE EXCEPTION 'GIF must be HTTPS';
    END IF;
    v_host := lower(split_part(split_part(NEW.media_url, '://', 2), '/', 1));
    IF v_host NOT IN (
      'media.giphy.com',
      'i.giphy.com',
      'media0.giphy.com',
      'media1.giphy.com',
      'media2.giphy.com',
      'media3.giphy.com',
      'media4.giphy.com'
    ) AND storage_url_owner_folder(NEW.media_url, 'crew-kindle') IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'That GIF is not allowed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_messages_enforce_media ON crew_messages;
CREATE TRIGGER crew_messages_enforce_media
  BEFORE INSERT ON crew_messages
  FOR EACH ROW
  EXECUTE FUNCTION enforce_crew_message_media();

-- Clients may not change their own profile id.
REVOKE UPDATE ON TABLE profiles FROM PUBLIC;
REVOKE UPDATE ON TABLE profiles FROM authenticated;
GRANT UPDATE (
  name,
  avatar_url,
  bio,
  status_text,
  status_at,
  onboarding_completed_at,
  circle_add_policy,
  updated_at
) ON TABLE profiles TO authenticated;

CREATE OR REPLACE FUNCTION increment_open_view_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE opens SET view_count = view_count + 1 WHERE id = NEW.open_id;
  RETURN NEW;
END;
$$;
