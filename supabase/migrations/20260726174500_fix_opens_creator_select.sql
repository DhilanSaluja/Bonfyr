-- Creators need to see their own opens. Without this, insert().select() fails
-- (and open_circles INSERT can't verify ownership before circle links exist).

DROP POLICY IF EXISTS "Creators can view own opens" ON opens;
CREATE POLICY "Creators can view own opens" ON opens FOR SELECT
  USING (creator_id = auth.uid());

DROP POLICY IF EXISTS "Creators can insert opens" ON opens;
CREATE POLICY "Creators can insert opens" ON opens FOR INSERT
  WITH CHECK (creator_id = auth.uid());
