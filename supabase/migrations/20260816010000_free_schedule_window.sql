-- Free can schedule Sparks up to 6 hours ahead; Pro up to 24 hours.
-- Replaces the old Pro-only gate on scheduled Sparks.

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
  v_max_hours INT;
  v_horizon TIMESTAMPTZ;
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
    v_max_hours := CASE WHEN COALESCE(v_tier, 'free') = 'pro' THEN 24 ELSE 6 END;
    -- Small buffer so near-boundary client slots are not rejected for clock skew.
    v_horizon := now() + (v_max_hours || ' hours')::INTERVAL + INTERVAL '90 seconds';

    IF p_scheduled_for > v_horizon THEN
      IF COALESCE(v_tier, 'free') <> 'pro' THEN
        RAISE EXCEPTION 'Free can schedule up to 6 hours ahead. Upgrade to Pro for 24-hour scheduling.';
      ELSE
        RAISE EXCEPTION 'You can schedule up to 24 hours from now.';
      END IF;
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

GRANT EXECUTE ON FUNCTION create_open_with_circles(
  TEXT, UUID[], location_mode, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ, open_status
) TO authenticated;
