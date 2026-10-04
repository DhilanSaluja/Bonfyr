-- Emoji reactions on Crew chat messages.
--
-- Design notes:
--  * circle_id is denormalised so RLS can call is_circle_member() directly instead
--    of sub-querying crew_messages on every row. A BEFORE trigger fills it in from
--    the parent message, so a client can never point a reaction at a crew it is not in.
--  * ON DELETE CASCADE means reactions burn out with their message (24h chat TTL)
--    without a second cleanup job.
--  * REPLICA IDENTITY FULL so realtime DELETE payloads carry message_id/emoji/user_id.
--    With the default (primary key) identity the client would only receive the
--    reaction id on removal and could not tell which bubble to update.

CREATE TABLE IF NOT EXISTS crew_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES crew_messages(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crew_message_reactions_unique UNIQUE (message_id, user_id, emoji),
  CONSTRAINT crew_message_reactions_emoji_check CHECK (
    emoji IN (
      E'\u2764\uFE0F',  -- red heart
      E'\U0001F602',    -- face with tears of joy
      E'\U0001F44D',    -- thumbs up
      E'\U0001F44E',    -- thumbs down
      E'\u203C\uFE0F',  -- double exclamation
      E'\u2753',        -- question mark
      E'\U0001F62D',    -- loudly crying face
      E'\U0001F525'     -- fire
    )
  )
);

-- (message_id, user_id, emoji) unique index already serves lookups by message_id.
CREATE INDEX IF NOT EXISTS crew_message_reactions_circle_idx
  ON crew_message_reactions (circle_id);

ALTER TABLE crew_message_reactions ENABLE ROW LEVEL SECURITY;

-- ── Ownership / integrity ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_crew_message_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_circle_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT circle_id, expires_at
    INTO v_circle_id, v_expires_at
  FROM crew_messages
  WHERE id = NEW.message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF v_expires_at <= now() THEN
    RAISE EXCEPTION 'That message burned out';
  END IF;

  -- Never trust a client-supplied circle_id.
  NEW.circle_id := v_circle_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_message_reactions_enforce ON crew_message_reactions;
CREATE TRIGGER crew_message_reactions_enforce
  BEFORE INSERT ON crew_message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_crew_message_reaction();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- RLS WITH CHECK runs after BEFORE-ROW triggers, so it validates the
-- trigger-resolved circle_id rather than whatever the client sent.

DROP POLICY IF EXISTS "crew_message_reactions_select_member" ON crew_message_reactions;
CREATE POLICY "crew_message_reactions_select_member" ON crew_message_reactions
  FOR SELECT TO authenticated
  USING (is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_message_reactions_insert_own" ON crew_message_reactions;
CREATE POLICY "crew_message_reactions_insert_own" ON crew_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_circle_member(circle_id));

DROP POLICY IF EXISTS "crew_message_reactions_delete_own" ON crew_message_reactions;
CREATE POLICY "crew_message_reactions_delete_own" ON crew_message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- No UPDATE policy: a reaction is add-or-remove, never edited in place.
REVOKE UPDATE ON TABLE crew_message_reactions FROM PUBLIC;
REVOKE UPDATE ON TABLE crew_message_reactions FROM authenticated;

-- ── Atomic toggle ───────────────────────────────────────────────────────────
-- Doing delete-or-insert in one round trip keeps double-taps from racing into
-- a duplicate-key error, and returns the fresh summary so the caller can
-- reconcile its optimistic state.

CREATE OR REPLACE FUNCTION toggle_crew_message_reaction(
  p_message_id UUID,
  p_emoji TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_circle_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_deleted INT;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_emoji IS NULL OR p_emoji NOT IN (
    E'\u2764\uFE0F', E'\U0001F602', E'\U0001F44D', E'\U0001F44E',
    E'\u203C\uFE0F', E'\u2753', E'\U0001F62D', E'\U0001F525'
  ) THEN
    RAISE EXCEPTION 'Unsupported reaction';
  END IF;

  SELECT circle_id, expires_at
    INTO v_circle_id, v_expires_at
  FROM crew_messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF v_expires_at <= now() THEN
    RAISE EXCEPTION 'That message burned out';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = v_circle_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Not a Crew member';
  END IF;

  DELETE FROM crew_message_reactions
  WHERE message_id = p_message_id
    AND user_id = v_uid
    AND emoji = p_emoji;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    INSERT INTO crew_message_reactions (message_id, circle_id, user_id, emoji)
    VALUES (p_message_id, v_circle_id, v_uid, p_emoji)
    ON CONFLICT ON CONSTRAINT crew_message_reactions_unique DO NOTHING;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('emoji', g.emoji, 'count', g.cnt, 'me', g.me)
      ORDER BY g.first_at
    ),
    '[]'::jsonb
  )
    INTO v_result
  FROM (
    SELECT
      emoji,
      COUNT(*)::int AS cnt,
      bool_or(user_id = v_uid) AS me,
      MIN(created_at) AS first_at
    FROM crew_message_reactions
    WHERE message_id = p_message_id
    GROUP BY emoji
  ) g;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION toggle_crew_message_reaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_crew_message_reaction(UUID, TEXT) TO authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────

ALTER TABLE crew_message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE crew_message_reactions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;
