-- Let a Crew member add someone already on Bonfyr (matched from contacts).
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

REVOKE ALL ON FUNCTION add_circle_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_circle_member(UUID, UUID) TO authenticated;
