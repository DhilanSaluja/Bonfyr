-- Pro lasts for the period that was paid for: one month or one year.
-- A missing end date no longer keeps Pro on forever.

CREATE OR REPLACE FUNCTION profile_is_pro(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = p_user_id
      AND subscription_tier = 'pro'
      AND subscription_expires_at IS NOT NULL
      AND subscription_expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION profile_is_pro(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profile_is_pro(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION profile_is_pro(UUID) TO service_role;

-- Clamp each paid purchase to one billing period from now.
UPDATE user_purchases
SET expires_at = CASE
  WHEN product_id ILIKE '%year%' THEN
    least(
      COALESCE(expires_at, created_at + INTERVAL '1 year'),
      now() + INTERVAL '1 year' + INTERVAL '3 days'
    )
  ELSE
    least(
      COALESCE(expires_at, created_at + INTERVAL '1 month'),
      now() + INTERVAL '1 month' + INTERVAL '3 days'
    )
END
WHERE purchase_state = 0;

-- Point each Pro profile at the latest still-valid purchase end date.
UPDATE profiles p
SET
  subscription_expires_at = active.ends_at,
  updated_at = now()
FROM (
  SELECT DISTINCT ON (user_id)
    user_id,
    expires_at AS ends_at
  FROM user_purchases
  WHERE purchase_state = 0
    AND expires_at IS NOT NULL
  ORDER BY user_id, expires_at DESC
) active
WHERE p.id = active.user_id
  AND p.subscription_tier = 'pro';

SELECT revoke_expired_subscriptions();

-- Pro with no paid period left is Free.
UPDATE profiles
SET
  subscription_tier = 'free',
  subscription_status = 'expired',
  subscription_expires_at = COALESCE(subscription_expires_at, now()),
  updated_at = now()
WHERE subscription_tier = 'pro'
  AND (
    subscription_expires_at IS NULL
    OR subscription_expires_at <= now()
  );

CREATE OR REPLACE FUNCTION create_circle_with_limit(
  p_name TEXT,
  p_color TEXT,
  p_owner_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
  v_circle_id UUID;
  v_name TEXT := left(trim(coalesce(p_name, '')), 48);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Give this Crew a name';
  END IF;

  SELECT COUNT(*) INTO v_count FROM circles WHERE owner_id = v_uid;

  IF NOT profile_is_pro(v_uid) AND v_count >= 5 THEN
    RAISE EXCEPTION 'Free tier limited to 5 circles. Upgrade to Pro for unlimited.';
  END IF;

  INSERT INTO circles (name, color, owner_id)
  VALUES (v_name, COALESCE(NULLIF(trim(p_color), ''), '#E8A838'), v_uid)
  RETURNING id INTO v_circle_id;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, v_uid);

  RETURN v_circle_id;
END;
$$;

CREATE OR REPLACE FUNCTION join_circle_by_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle_id UUID;
  v_count INTEGER;
  v_clean TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean := trim(p_token);
  IF v_clean = '' THEN
    RAISE EXCEPTION 'Enter an invite code';
  END IF;

  SELECT id INTO v_circle_id FROM circles WHERE invite_token = v_clean;
  IF v_circle_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  IF EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = v_circle_id AND user_id = auth.uid()
  ) THEN
    RETURN v_circle_id;
  END IF;

  SELECT COUNT(*) INTO v_count FROM circle_members WHERE user_id = auth.uid();

  IF NOT profile_is_pro(auth.uid()) AND v_count >= 5 THEN
    RAISE EXCEPTION 'Free plan is limited to 5 Crews. Upgrade to Pro to join more.';
  END IF;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_circle_id;
END;
$$;

CREATE OR REPLACE FUNCTION add_circle_member(p_circle_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'That person is not on Bonfyr';
  END IF;

  SELECT COUNT(*) INTO v_count FROM circle_members WHERE user_id = p_user_id;
  IF NOT profile_is_pro(p_user_id) AND v_count >= 5 THEN
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

    IF NOT profile_is_pro(v_uid) THEN
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

CREATE OR REPLACE FUNCTION can_post_to_circle(p_user_id UUID, p_circle_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle_rank INTEGER;
BEGIN
  IF profile_is_pro(p_user_id) THEN RETURN true; END IF;

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
