-- Close production holes: public expire RPC, unlimited invite joins,
-- owner self-leave, and stale Pro entitlements.

REVOKE EXECUTE ON FUNCTION expire_stale_crew_messages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expire_stale_crew_messages() FROM authenticated;
GRANT EXECUTE ON FUNCTION expire_stale_crew_messages() TO service_role;

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_circle_id FROM circles WHERE invite_token = p_token;
  IF v_circle_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite link';
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

DROP POLICY IF EXISTS "circle_members_delete_self" ON circle_members;
CREATE POLICY "circle_members_delete_self" ON circle_members FOR DELETE
  USING (user_id = auth.uid() AND NOT is_circle_owner(circle_id));

CREATE OR REPLACE FUNCTION revoke_expired_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE profiles
  SET
    subscription_tier = 'free',
    subscription_status = 'expired',
    updated_at = now()
  WHERE subscription_tier = 'pro'
    AND subscription_expires_at IS NOT NULL
    AND subscription_expires_at < now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION revoke_expired_subscriptions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revoke_expired_subscriptions() FROM authenticated;
GRANT EXECUTE ON FUNCTION revoke_expired_subscriptions() TO service_role;
