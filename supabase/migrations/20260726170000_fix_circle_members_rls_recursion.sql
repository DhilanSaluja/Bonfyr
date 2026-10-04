-- Fix infinite recursion: circle_members SELECT policy queried circle_members under RLS,
-- and circles ↔ circle_members policies could cycle on writes.

CREATE OR REPLACE FUNCTION is_circle_member(p_circle_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM circle_members
    WHERE circle_id = p_circle_id
      AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Members can view circle membership" ON circle_members;
CREATE POLICY "Members can view circle membership" ON circle_members FOR SELECT
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "Members can view their circles" ON circles;
CREATE POLICY "Members can view their circles" ON circles FOR SELECT
  USING (owner_id = auth.uid() OR is_circle_member(id));
