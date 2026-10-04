-- Production lock-down before store launch:
-- 1) Circle create must use auth.uid() (ignore client-supplied owner id)
-- 2) Users cannot self-grant Pro / billing fields
-- 3) Wider photo/video MIME types so library exports actually upload
-- 4) Harden leftover SECURITY DEFINER helpers

-- ── Circle create: never trust p_owner_id ───────────────────────────────────

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
  v_tier subscription_tier;
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

  -- p_owner_id is ignored; ownership is always the signed-in user.
  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = v_uid;
  SELECT COUNT(*) INTO v_count FROM circles WHERE owner_id = v_uid;

  IF COALESCE(v_tier, 'free') = 'free' AND v_count >= 5 THEN
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

REVOKE ALL ON FUNCTION create_circle_with_limit(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_circle_with_limit(TEXT, TEXT, UUID) TO authenticated;

-- ── Spark end/leave: pin search_path ────────────────────────────────────────

CREATE OR REPLACE FUNCTION leave_open(p_open_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM open_joiners
  WHERE open_id = p_open_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION end_own_open(p_open_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  UPDATE opens
  SET status = 'expired', expires_at = now()
  WHERE id = p_open_id AND creator_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION leave_open(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION end_own_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION leave_open(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION end_own_open(UUID) TO authenticated;

-- ── Entitlements: only service_role / SQL console may change Pro fields ─────

CREATE OR REPLACE FUNCTION protect_profile_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres', 'supabase_auth_admin')
     OR current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.subscription_tier := OLD.subscription_tier;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_expires_at := OLD.subscription_expires_at;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.subscription_tier := 'free';
    NEW.subscription_status := 'active';
    NEW.subscription_expires_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_entitlements ON profiles;
CREATE TRIGGER profiles_protect_entitlements
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_entitlements();

CREATE OR REPLACE FUNCTION protect_private_billing_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres', 'supabase_auth_admin')
     OR current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_private_protect_billing ON profile_private;
CREATE TRIGGER profile_private_protect_billing
  BEFORE INSERT OR UPDATE ON profile_private
  FOR EACH ROW
  EXECUTE FUNCTION protect_private_billing_fields();

-- ── Storage MIME allow-lists (library/camera exports) ───────────────────────

UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2'
  ]
WHERE id = 'crew-kindle';

UPDATE storage.buckets
SET
  file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 8388608),
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
WHERE id IN ('avatars', 'crew-photos');

-- Ensure columns exist before column-level GRANTs (remote DBs may have skipped earlier migrations).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS status_text TEXT,
  ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS circle_add_policy circle_add_policy NOT NULL DEFAULT 'invite_only';

ALTER TABLE profile_private
  ADD COLUMN IF NOT EXISTS quiet_hours_tz TEXT;

-- Clients may not UPDATE entitlement / billing columns even if they try.
REVOKE UPDATE ON TABLE profiles FROM PUBLIC;
REVOKE UPDATE ON TABLE profiles FROM authenticated;
GRANT UPDATE (
  name,
  avatar_url,
  bio,
  status_text,
  status_at,
  onboarding_completed_at,
  circle_add_policy,
  updated_at
) ON TABLE profiles TO authenticated;

REVOKE UPDATE ON TABLE profile_private FROM PUBLIC;
REVOKE UPDATE ON TABLE profile_private FROM authenticated;
GRANT UPDATE (
  user_id,
  phone,
  phone_hash,
  push_token,
  favorite_contact_ids,
  quiet_hours_enabled,
  quiet_hours_start,
  quiet_hours_end,
  quiet_hours_tz,
  updated_at
) ON TABLE profile_private TO authenticated;
