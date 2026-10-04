-- Live functions still raise the old "Bonfire" exception text.
-- Editing already-applied migrations does not change Postgres.
-- This REPLACE updates only the user-facing brand strings.

CREATE OR REPLACE FUNCTION add_circle_member(p_circle_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier subscription_tier;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_circle_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing Crew or person';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use an invite code to join a Crew yourself';
  END IF;
  IF NOT is_circle_member(p_circle_id) THEN
    RAISE EXCEPTION 'Only Crew members can add people';
  END IF;
  IF EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = p_circle_id AND user_id = p_user_id
  ) THEN
    RETURN p_circle_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = auth.uid() AND blocked_id = p_user_id)
       OR (blocker_id = p_user_id AND blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Cannot add this person';
  END IF;

  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not on Bonfyr';
  END IF;

  SELECT COUNT(*) INTO v_count FROM circle_members WHERE user_id = p_user_id;
  IF COALESCE(v_tier, 'free') = 'free' AND v_count >= 5 THEN
    RAISE EXCEPTION 'This person is on the Free plan and already in 5 Crews.';
  END IF;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (p_circle_id, p_user_id)
  ON CONFLICT DO NOTHING;

  RETURN p_circle_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_open_with_circles(
  p_description TEXT,
  p_circle_ids UUID[],
  p_location_mode location_mode,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_fuzzed_latitude DOUBLE PRECISION,
  p_fuzzed_longitude DOUBLE PRECISION,
  p_expires_at TIMESTAMPTZ,
  p_scheduled_for TIMESTAMPTZ,
  p_status open_status
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_open_id UUID;
  v_circle_id UUID;
  v_tier subscription_tier;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_circle_ids IS NULL OR array_length(p_circle_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one Crew';
  END IF;

  IF p_scheduled_for IS NOT NULL THEN
    IF p_scheduled_for <= now() THEN
      RAISE EXCEPTION 'Pick a future time for this Spark';
    END IF;

    SELECT subscription_tier INTO v_tier FROM profiles WHERE id = v_uid;
    IF COALESCE(v_tier, 'free') <> 'pro' THEN
      RAISE EXCEPTION 'Scheduling Sparks requires Bonfyr Pro';
    END IF;

    IF p_scheduled_for > now() + INTERVAL '24 hours' + INTERVAL '90 seconds' THEN
      RAISE EXCEPTION 'You can schedule up to 24 hours from now.';
    END IF;
  END IF;

  FOREACH v_circle_id IN ARRAY p_circle_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM circle_members
      WHERE circle_id = v_circle_id AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Not a member of selected Crew';
    END IF;
    IF NOT can_post_to_circle(v_uid, v_circle_id) THEN
      RAISE EXCEPTION 'Cannot post to this Crew on Free plan';
    END IF;
  END LOOP;

  INSERT INTO opens (
    creator_id, description, location_mode,
    latitude, longitude, fuzzed_latitude, fuzzed_longitude,
    expires_at, scheduled_for, status
  ) VALUES (
    v_uid, p_description, p_location_mode,
    p_latitude, p_longitude, p_fuzzed_latitude, p_fuzzed_longitude,
    p_expires_at, p_scheduled_for, p_status
  )
  RETURNING id INTO v_open_id;

  INSERT INTO open_circles (open_id, circle_id)
  SELECT v_open_id, unnest(p_circle_ids);

  RETURN v_open_id;
END;
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
