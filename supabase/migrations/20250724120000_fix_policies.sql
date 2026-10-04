-- Allow owners/members flows that were missing INSERT policies

CREATE POLICY "Users can insert themselves as members via invite"
  ON circle_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM circles c
        WHERE c.id = circle_members.circle_id
          AND c.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM circles c
        WHERE c.id = circle_members.circle_id
      )
    )
  );

CREATE OR REPLACE FUNCTION join_circle_by_invite(p_token TEXT)
RETURNS UUID AS $$
DECLARE
  v_circle_id UUID;
BEGIN
  SELECT id INTO v_circle_id FROM circles WHERE invite_token = p_token;
  IF v_circle_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite link';
  END IF;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_circle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Users can leave opens they joined"
  ON open_joiners FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Creators can delete own opens"
  ON opens FOR DELETE
  USING (creator_id = auth.uid());

CREATE OR REPLACE FUNCTION leave_open(p_open_id UUID)
RETURNS VOID AS $$
BEGIN
  DELETE FROM open_joiners
  WHERE open_id = p_open_id AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION end_own_open(p_open_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE opens
  SET status = 'expired', expires_at = now()
  WHERE id = p_open_id AND creator_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
