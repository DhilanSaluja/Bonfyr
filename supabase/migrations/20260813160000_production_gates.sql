-- Production gates: scheduled Sparks are Pro-only, no client circle insert bypass,
-- and new-user inserts are idempotent.

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
    SELECT subscription_tier INTO v_tier FROM profiles WHERE id = v_uid;
    IF COALESCE(v_tier, 'free') <> 'pro' THEN
      RAISE EXCEPTION 'Scheduling Sparks requires Bonfyr Pro';
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

DROP POLICY IF EXISTS "circles_insert_own" ON circles;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '');
  IF v_name IS NULL THEN
    v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'given_name'), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := 'Neighbor';
  END IF;

  INSERT INTO profiles (id, name)
  VALUES (NEW.id, LEFT(v_name, 48))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile_private (user_id, phone)
  VALUES (NEW.id, NEW.phone)
  ON CONFLICT (user_id) DO UPDATE
    SET phone = COALESCE(EXCLUDED.phone, profile_private.phone);

  RETURN NEW;
END;
$$;

ALTER TABLE profile_private
  ADD COLUMN IF NOT EXISTS quiet_hours_tz TEXT;

GRANT EXECUTE ON FUNCTION create_open_with_circles(
  TEXT, UUID[], location_mode, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ, open_status
) TO authenticated;
