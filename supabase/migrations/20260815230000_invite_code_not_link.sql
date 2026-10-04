-- Invite joins use codes (not deep links). Keep the error message accurate.
CREATE OR REPLACE FUNCTION join_circle_by_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle_id UUID;
  v_tier subscription_tier;
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

  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = auth.uid();
  SELECT COUNT(*) INTO v_count FROM circle_members WHERE user_id = auth.uid();

  IF COALESCE(v_tier, 'free') = 'free' AND v_count >= 5 THEN
    RAISE EXCEPTION 'Free plan is limited to 5 Crews. Upgrade to Pro to join more.';
  END IF;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_circle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION join_circle_by_invite(TEXT) TO authenticated;
