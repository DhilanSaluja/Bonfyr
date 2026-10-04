-- Rich crew chat: image / gif / poll messages + poll voting.

ALTER TABLE crew_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crew_messages_message_type_check'
  ) THEN
    ALTER TABLE crew_messages
      ADD CONSTRAINT crew_messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'gif', 'poll'));
  END IF;
END $$;

-- Allow short placeholders for media/polls (body still required by existing CHECK).
-- Existing CHECK: char_length(trim(body)) > 0 AND char_length(body) <= 2000

CREATE OR REPLACE FUNCTION vote_crew_poll(p_message_id UUID, p_option_index INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_msg crew_messages%ROWTYPE;
  v_votes JSONB;
  v_options JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_option_index < 0 THEN
    RAISE EXCEPTION 'Invalid option';
  END IF;

  SELECT * INTO v_msg FROM crew_messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found';
  END IF;
  IF v_msg.message_type <> 'poll' THEN
    RAISE EXCEPTION 'Not a poll';
  END IF;
  IF v_msg.expires_at <= now() THEN
    RAISE EXCEPTION 'Poll burned out';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM circle_members
    WHERE circle_id = v_msg.circle_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Not a Crew member';
  END IF;

  v_options := COALESCE(v_msg.meta->'options', '[]'::jsonb);
  IF p_option_index >= jsonb_array_length(v_options) THEN
    RAISE EXCEPTION 'Invalid option';
  END IF;

  v_votes := COALESCE(v_msg.meta->'votes', '{}'::jsonb);
  v_votes := jsonb_set(v_votes, ARRAY[v_uid::text], to_jsonb(p_option_index), true);

  UPDATE crew_messages
  SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{votes}', v_votes, true)
  WHERE id = p_message_id
  RETURNING meta INTO v_msg.meta;

  RETURN v_msg.meta;
END;
$$;

GRANT EXECUTE ON FUNCTION vote_crew_poll(UUID, INT) TO authenticated;

-- Chat media in existing crew-kindle bucket (path prefix chat/)
-- No bucket change required if crew-kindle already allows authenticated uploads.
