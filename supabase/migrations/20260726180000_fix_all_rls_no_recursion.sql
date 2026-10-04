-- Comprehensive RLS fix: break all cross-table policy recursion with
-- SECURITY DEFINER helpers, and cover missing INSERT/SELECT policies
-- used by Bonfyr (profile, sparks, crews, join/leave, mutes, views).

-- ── Helpers (bypass RLS; only check auth.uid()) ─────────────────────────────

CREATE OR REPLACE FUNCTION is_circle_member(p_circle_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = p_circle_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_circle_owner(p_circle_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM circles
    WHERE id = p_circle_id AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_open_creator(p_open_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM opens
    WHERE id = p_open_id AND creator_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION can_view_open(p_open_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM opens WHERE id = p_open_id AND creator_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM open_circles oc
    JOIN circle_members cm ON cm.circle_id = oc.circle_id
    WHERE oc.open_id = p_open_id AND cm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION shares_circle_with(p_other_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM circle_members me
    JOIN circle_members them ON them.circle_id = me.circle_id
    WHERE me.user_id = auth.uid() AND them.user_id = p_other_user_id
  );
$$;

-- Atomic spark create (avoids opens ↔ open_circles RLS cycles on insert)
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

GRANT EXECUTE ON FUNCTION is_circle_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_circle_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_open_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_view_open(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION shares_circle_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_open_with_circles(
  TEXT, UUID[], location_mode, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, TIMESTAMPTZ, TIMESTAMPTZ, open_status
) TO authenticated;

-- ── Drop old policies ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view circle member profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

DROP POLICY IF EXISTS "Members can view their circles" ON circles;
DROP POLICY IF EXISTS "Owner can update circle" ON circles;
DROP POLICY IF EXISTS "Owner can delete circle" ON circles;
DROP POLICY IF EXISTS "Owners can insert circles" ON circles;

DROP POLICY IF EXISTS "Members can view circle membership" ON circle_members;
DROP POLICY IF EXISTS "Owner can remove members" ON circle_members;
DROP POLICY IF EXISTS "Users can leave circles" ON circle_members;
DROP POLICY IF EXISTS "Users can insert themselves as members via invite" ON circle_members;

DROP POLICY IF EXISTS "Users manage own mutes" ON muted_circles;

DROP POLICY IF EXISTS "Circle members see opens" ON opens;
DROP POLICY IF EXISTS "Creators can view own opens" ON opens;
DROP POLICY IF EXISTS "Creators can insert opens" ON opens;
DROP POLICY IF EXISTS "Creators can update own opens" ON opens;
DROP POLICY IF EXISTS "Creators can delete own opens" ON opens;

DROP POLICY IF EXISTS "Members see open_circles" ON open_circles;
DROP POLICY IF EXISTS "Creators can link opens to circles" ON open_circles;

DROP POLICY IF EXISTS "Members see joiners" ON open_joiners;
DROP POLICY IF EXISTS "Users can join opens" ON open_joiners;
DROP POLICY IF EXISTS "Users can leave opens they joined" ON open_joiners;

DROP POLICY IF EXISTS "Users can record views" ON open_views;
DROP POLICY IF EXISTS "Users see own views" ON open_views;
DROP POLICY IF EXISTS "Users update own views" ON open_views;

DROP POLICY IF EXISTS "Users see own notifications" ON notification_logs;
DROP POLICY IF EXISTS "Users update own notifications" ON notification_logs;

DROP POLICY IF EXISTS "Users see own subscription" ON subscription_records;

-- ── Profiles ────────────────────────────────────────────────────────────────

CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_select_shared_circle" ON profiles FOR SELECT
  USING (shares_circle_with(id));

CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── Circles ─────────────────────────────────────────────────────────────────

CREATE POLICY "circles_select_member_or_owner" ON circles FOR SELECT
  USING (owner_id = auth.uid() OR is_circle_member(id));

CREATE POLICY "circles_insert_own" ON circles FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "circles_update_owner" ON circles FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "circles_delete_owner" ON circles FOR DELETE
  USING (owner_id = auth.uid());

-- ── Circle members ──────────────────────────────────────────────────────────

CREATE POLICY "circle_members_select" ON circle_members FOR SELECT
  USING (is_circle_member(circle_id));

-- Direct inserts: owner adding themselves (invite joins use join_circle_by_invite RPC)
CREATE POLICY "circle_members_insert_self" ON circle_members FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_circle_owner(circle_id));

CREATE POLICY "circle_members_delete_self" ON circle_members FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "circle_members_delete_owner" ON circle_members FOR DELETE
  USING (is_circle_owner(circle_id));

-- ── Muted circles ───────────────────────────────────────────────────────────

CREATE POLICY "muted_circles_all_own" ON muted_circles FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Opens (no subquery to open_circles in policies) ─────────────────────────

CREATE POLICY "opens_select" ON opens FOR SELECT
  USING (can_view_open(id));

CREATE POLICY "opens_insert_own" ON opens FOR INSERT
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "opens_update_own" ON opens FOR UPDATE
  USING (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "opens_delete_own" ON opens FOR DELETE
  USING (creator_id = auth.uid());

-- ── Open circles (no subquery to opens policies) ────────────────────────────

CREATE POLICY "open_circles_select" ON open_circles FOR SELECT
  USING (is_circle_member(circle_id) OR is_open_creator(open_id));

CREATE POLICY "open_circles_insert" ON open_circles FOR INSERT
  WITH CHECK (
    is_open_creator(open_id)
    AND is_circle_member(circle_id)
    AND can_post_to_circle(auth.uid(), circle_id)
  );

-- ── Open joiners ────────────────────────────────────────────────────────────

CREATE POLICY "open_joiners_select" ON open_joiners FOR SELECT
  USING (can_view_open(open_id));

CREATE POLICY "open_joiners_insert" ON open_joiners FOR INSERT
  WITH CHECK (user_id = auth.uid() AND can_view_open(open_id));

CREATE POLICY "open_joiners_delete_own" ON open_joiners FOR DELETE
  USING (user_id = auth.uid());

-- ── Open views (upsert needs select/update) ─────────────────────────────────

CREATE POLICY "open_views_select_own" ON open_views FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "open_views_insert_own" ON open_views FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "open_views_update_own" ON open_views FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Notifications / subscriptions ───────────────────────────────────────────

CREATE POLICY "notification_logs_select_own" ON notification_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notification_logs_update_own" ON notification_logs FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "subscription_records_select_own" ON subscription_records FOR SELECT
  USING (user_id = auth.uid());

-- Keep invite join working under the new policies
CREATE OR REPLACE FUNCTION join_circle_by_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_circle_id FROM circles WHERE invite_token = p_token;
  IF v_circle_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite link';
  END IF;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN v_circle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION join_circle_by_invite(TEXT) TO authenticated;
