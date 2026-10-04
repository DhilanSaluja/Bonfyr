-- Crew chat burns after 24h + optional anonymous mode (default named)

ALTER TABLE circles
  ADD COLUMN IF NOT EXISTS chat_anonymous BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE crew_messages
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE crew_messages
SET expires_at = created_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

ALTER TABLE crew_messages
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '24 hours');

ALTER TABLE crew_messages
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS crew_messages_circle_expires_idx
  ON crew_messages (circle_id, expires_at DESC, created_at DESC);

-- Keep unread counts to non-expired messages only
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
    AND m.expires_at > now()
    AND m.created_at > COALESCE(r.last_read_at, '1970-01-01'::timestamptz)
  WHERE cm.user_id = auth.uid()
  GROUP BY cm.circle_id;
$$;

CREATE OR REPLACE FUNCTION set_circle_chat_anonymous(p_circle_id UUID, p_anonymous BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_circle_owner(p_circle_id) THEN
    RAISE EXCEPTION 'Only the Crew owner can change anonymous chat';
  END IF;

  UPDATE circles
  SET chat_anonymous = p_anonymous
  WHERE id = p_circle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_circle_chat_anonymous(UUID, BOOLEAN) TO authenticated;
