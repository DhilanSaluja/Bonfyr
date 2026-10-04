-- Crew Chat + lock sensitive profile fields so only the owner can read them.

-- ── Private profile data (phone, push token, quiet hours, etc.) ─────────────

CREATE TABLE IF NOT EXISTS profile_private (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  phone TEXT,
  phone_hash TEXT UNIQUE,
  push_token TEXT,
  favorite_contact_ids UUID[] NOT NULL DEFAULT '{}',
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_private_phone_hash_idx
  ON profile_private (phone_hash)
  WHERE phone_hash IS NOT NULL;

-- Copy existing sensitive columns before dropping them from profiles
INSERT INTO profile_private (
  user_id, phone, phone_hash, push_token, favorite_contact_ids,
  quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
  stripe_customer_id, stripe_subscription_id, updated_at
)
SELECT
  id,
  phone,
  phone_hash,
  push_token,
  COALESCE(favorite_contact_ids, '{}'),
  COALESCE(quiet_hours_enabled, false),
  quiet_hours_start,
  quiet_hours_end,
  stripe_customer_id,
  stripe_subscription_id,
  COALESCE(updated_at, now())
FROM profiles
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS phone_hash,
  DROP COLUMN IF EXISTS push_token,
  DROP COLUMN IF EXISTS favorite_contact_ids,
  DROP COLUMN IF EXISTS quiet_hours_enabled,
  DROP COLUMN IF EXISTS quiet_hours_start,
  DROP COLUMN IF EXISTS quiet_hours_end,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;

ALTER TABLE profile_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_private_select_own" ON profile_private;
CREATE POLICY "profile_private_select_own" ON profile_private FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "profile_private_insert_own" ON profile_private;
CREATE POLICY "profile_private_insert_own" ON profile_private FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profile_private_update_own" ON profile_private;
CREATE POLICY "profile_private_update_own" ON profile_private FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profile_private_delete_own" ON profile_private;
CREATE POLICY "profile_private_delete_own" ON profile_private FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Keep a private row in sync when a profile is created
CREATE OR REPLACE FUNCTION ensure_profile_private()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profile_private (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_ensure_private ON profiles;
CREATE TRIGGER profiles_ensure_private
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION ensure_profile_private();

-- Contacts match: look up hashes in private table; never return another user's phone
CREATE OR REPLACE FUNCTION match_users_by_phone_hashes(p_hashes TEXT[])
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, phone_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hashes IS NULL OR cardinality(p_hashes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url, pp.phone_hash
  FROM profile_private pp
  JOIN profiles p ON p.id = pp.user_id
  WHERE pp.phone_hash = ANY (p_hashes)
    AND pp.phone_hash IS NOT NULL
    AND pp.user_id <> auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO service_role;

-- ── Crew chat messages ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_id UUID
);

CREATE INDEX IF NOT EXISTS crew_messages_circle_created_idx
  ON crew_messages (circle_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS crew_messages_client_id_uidx
  ON crew_messages (user_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE crew_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_messages_select_member" ON crew_messages;
CREATE POLICY "crew_messages_select_member" ON crew_messages FOR SELECT TO authenticated
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_messages_insert_member" ON crew_messages;
CREATE POLICY "crew_messages_insert_member" ON crew_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_messages_delete_own" ON crew_messages;
CREATE POLICY "crew_messages_delete_own" ON crew_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Per-member read cursor for unread badges
CREATE TABLE IF NOT EXISTS crew_chat_reads (
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

ALTER TABLE crew_chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_chat_reads_select_member" ON crew_chat_reads;
CREATE POLICY "crew_chat_reads_select_member" ON crew_chat_reads FOR SELECT TO authenticated
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_chat_reads_upsert_own" ON crew_chat_reads;
CREATE POLICY "crew_chat_reads_insert_own" ON crew_chat_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_chat_reads_update_own" ON crew_chat_reads;
CREATE POLICY "crew_chat_reads_update_own" ON crew_chat_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_circle_member(circle_id));

-- Unread counts for the signed-in user across their crews
CREATE OR REPLACE FUNCTION fetch_crew_chat_unread_counts()
RETURNS TABLE (circle_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cm.circle_id,
    COUNT(m.id)::BIGINT AS unread_count
  FROM circle_members cm
  LEFT JOIN crew_chat_reads r
    ON r.circle_id = cm.circle_id AND r.user_id = auth.uid()
  LEFT JOIN crew_messages m
    ON m.circle_id = cm.circle_id
    AND m.user_id <> auth.uid()
    AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
  WHERE cm.user_id = auth.uid()
  GROUP BY cm.circle_id;
$$;

GRANT EXECUTE ON FUNCTION fetch_crew_chat_unread_counts() TO authenticated;

CREATE OR REPLACE FUNCTION mark_crew_chat_read(p_circle_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_circle_member(p_circle_id) THEN
    RAISE EXCEPTION 'Not a Crew member';
  END IF;

  INSERT INTO crew_chat_reads (circle_id, user_id, last_read_at)
  VALUES (p_circle_id, auth.uid(), now())
  ON CONFLICT (circle_id, user_id)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_crew_chat_read(UUID) TO authenticated;

-- Realtime for chat (members already gated by RLS)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE crew_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
