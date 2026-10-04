-- Bug sweep: close client-trust gaps, fix races, and keep pushes honest.

-- Internal helpers: cron, triggers, and edge functions only.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'record_crew_activity',
        'circles_fire_just_went_out',
        'circles_fire_dying',
        'purge_ephemeral_data',
        'expire_stale_opens',
        'activate_scheduled_opens',
        'expire_stale_crew_posts',
        'expire_stale_crew_messages',
        'revoke_expired_subscriptions',
        'profile_is_pro'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION crew_fire_bundle(UUID[]) FROM anon;

-- Spark timing comes from the server, not the phone.
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
  v_start TIMESTAMPTZ;
  v_length INTERVAL;
  v_status open_status;
  v_mode location_mode := p_location_mode;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_circle_ids IS NULL OR array_length(p_circle_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one Crew';
  END IF;

  IF p_scheduled_for IS NOT NULL THEN
    IF p_scheduled_for <= now() THEN
      RAISE EXCEPTION 'Pick a future time for this Spark';
    END IF;

    IF NOT profile_is_pro(v_uid) THEN
      RAISE EXCEPTION 'Scheduling Sparks requires Bonfyr Pro';
    END IF;

    IF p_scheduled_for > now() + INTERVAL '24 hours' + INTERVAL '90 seconds' THEN
      RAISE EXCEPTION 'You can schedule up to 24 hours from now.';
    END IF;
  END IF;

  v_start := COALESCE(p_scheduled_for, now());
  v_status := CASE WHEN p_scheduled_for IS NULL THEN 'active' ELSE 'scheduled' END::open_status;
  v_length := COALESCE(p_expires_at - v_start, INTERVAL '2 hours');
  v_length := LEAST(GREATEST(v_length, INTERVAL '15 minutes'), INTERVAL '12 hours');

  IF v_mode = 'precise' AND (p_latitude IS NULL OR p_longitude IS NULL) THEN
    v_mode := 'none';
  ELSIF v_mode = 'general' AND (p_fuzzed_latitude IS NULL OR p_fuzzed_longitude IS NULL) THEN
    v_mode := 'none';
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
    v_uid, p_description, v_mode,
    CASE WHEN v_mode = 'precise' THEN p_latitude END,
    CASE WHEN v_mode = 'precise' THEN p_longitude END,
    CASE WHEN v_mode = 'general' THEN p_fuzzed_latitude END,
    CASE WHEN v_mode = 'general' THEN p_fuzzed_longitude END,
    v_start + v_length, p_scheduled_for, v_status
  )
  RETURNING id INTO v_open_id;

  INSERT INTO open_circles (open_id, circle_id)
  SELECT DISTINCT v_open_id, unnest(p_circle_ids);

  RETURN v_open_id;
END;
$$;

-- A creator may end their Spark early, nothing else.
CREATE OR REPLACE FUNCTION protect_open_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres')
     OR current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  NEW.creator_id := OLD.creator_id;
  NEW.created_at := OLD.created_at;
  NEW.scheduled_for := OLD.scheduled_for;
  NEW.description := OLD.description;
  NEW.location_mode := OLD.location_mode;
  NEW.latitude := OLD.latitude;
  NEW.longitude := OLD.longitude;
  NEW.fuzzed_latitude := OLD.fuzzed_latitude;
  NEW.fuzzed_longitude := OLD.fuzzed_longitude;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'expired' THEN
    NEW.status := OLD.status;
  END IF;
  IF NEW.expires_at > OLD.expires_at THEN
    NEW.expires_at := OLD.expires_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opens_protect_fields ON opens;
CREATE TRIGGER opens_protect_fields
  BEFORE UPDATE ON opens
  FOR EACH ROW
  EXECUTE FUNCTION protect_open_fields();

-- Only live Sparks you did not start, from people you have not blocked.
CREATE OR REPLACE FUNCTION can_join_open(p_open_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM opens o
    WHERE o.id = p_open_id
      AND o.status IN ('active', 'scheduled')
      AND o.expires_at > now()
      AND o.creator_id <> auth.uid()
      AND can_view_open(o.id)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = auth.uid() AND b.blocked_id = o.creator_id)
           OR (b.blocker_id = o.creator_id AND b.blocked_id = auth.uid())
      )
  );
$$;

REVOKE ALL ON FUNCTION can_join_open(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_join_open(UUID) TO authenticated;

DROP POLICY IF EXISTS "open_joiners_insert" ON open_joiners;
CREATE POLICY "open_joiners_insert" ON open_joiners
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND can_join_open(open_id));

-- Notification history: the app may only mark rows read.
REVOKE UPDATE ON notification_logs FROM anon, authenticated;
GRANT UPDATE (read_at) ON notification_logs TO authenticated;

-- Chat and kindle lifetimes are fixed at 24h from when the server saw them.
CREATE OR REPLACE FUNCTION enforce_crew_row_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres')
     OR current_setting('role', true) IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  NEW.created_at := now();
  NEW.expires_at := now() + INTERVAL '24 hours';

  IF TG_TABLE_NAME = 'crew_posts' THEN
    NEW.status := 'active';
  ELSIF TG_TABLE_NAME = 'crew_messages' AND NEW.meta IS NOT NULL THEN
    NEW.meta := NEW.meta - 'votes';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_posts_enforce_times ON crew_posts;
CREATE TRIGGER crew_posts_enforce_times
  BEFORE INSERT ON crew_posts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_crew_row_times();

DROP TRIGGER IF EXISTS crew_messages_enforce_times ON crew_messages;
CREATE TRIGGER crew_messages_enforce_times
  BEFORE INSERT ON crew_messages
  FOR EACH ROW
  EXECUTE FUNCTION enforce_crew_row_times();

-- A reaction lives in the same Crew as the message it reacts to.
CREATE OR REPLACE FUNCTION align_message_reaction_circle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle UUID;
BEGIN
  SELECT circle_id INTO v_circle FROM crew_messages WHERE id = NEW.message_id;
  IF v_circle IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;
  NEW.circle_id := v_circle;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_message_reactions_align_circle ON crew_message_reactions;
CREATE TRIGGER crew_message_reactions_align_circle
  BEFORE INSERT ON crew_message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION align_message_reaction_circle();

-- Two people voting at once must not overwrite each other.
CREATE OR REPLACE FUNCTION vote_crew_poll(p_message_id UUID, p_option_index INTEGER)
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

  SELECT * INTO v_msg FROM crew_messages WHERE id = p_message_id FOR UPDATE;
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

-- One device token belongs to one account: the last person signed in on it.
CREATE OR REPLACE FUNCTION claim_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_token IS NULL OR length(p_token) < 10 OR length(p_token) > 300 THEN
    RAISE EXCEPTION 'Invalid push token';
  END IF;

  UPDATE profile_private
  SET push_token = NULL, updated_at = now()
  WHERE push_token = p_token AND user_id <> v_uid;

  INSERT INTO profile_private (user_id, push_token, updated_at)
  VALUES (v_uid, p_token, now())
  ON CONFLICT (user_id) DO UPDATE
    SET push_token = EXCLUDED.push_token,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION claim_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_push_token(TEXT) TO authenticated;

-- Latest live message per Crew, without leaking names from anonymous chats.
CREATE INDEX IF NOT EXISTS crew_messages_circle_created_idx
  ON crew_messages (circle_id, created_at DESC);

CREATE OR REPLACE FUNCTION crew_chat_previews(p_circle_ids UUID[])
RETURNS TABLE (
  circle_id UUID,
  body TEXT,
  created_at TIMESTAMPTZ,
  user_id UUID,
  author_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    m.body,
    m.created_at,
    m.user_id,
    CASE
      WHEN c.chat_anonymous AND m.user_id <> auth.uid() THEN NULL
      ELSE p.name
    END
  FROM unnest(COALESCE(p_circle_ids, '{}')) AS ids(id)
  JOIN circles c ON c.id = ids.id
  CROSS JOIN LATERAL (
    SELECT cm.body, cm.created_at, cm.user_id
    FROM crew_messages cm
    WHERE cm.circle_id = c.id
      AND cm.expires_at > now()
    ORDER BY cm.created_at DESC
    LIMIT 1
  ) m
  LEFT JOIN profiles p ON p.id = m.user_id
  WHERE auth.uid() IS NOT NULL
    AND is_circle_member(c.id);
$$;

REVOKE ALL ON FUNCTION crew_chat_previews(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crew_chat_previews(UUID[]) TO authenticated;

-- A push failure must never roll back the chat message or kindle itself.
CREATE OR REPLACE FUNCTION public.request_crew_activity_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth text;
  v_preview text;
  v_body jsonb;
BEGIN
  BEGIN
    SELECT substring(command from 'Bearer ([^"''[:space:]]+)')
      INTO v_auth
      FROM cron.job
      WHERE jobname = 'expire-opens'
      LIMIT 1;

    IF v_auth IS NULL OR length(v_auth) < 10 THEN
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'crew_messages' THEN
      v_preview := CASE coalesce(NEW.message_type, 'text')
        WHEN 'image' THEN 'Sent a photo'
        WHEN 'video' THEN 'Sent a video'
        WHEN 'gif' THEN 'Sent a GIF'
        WHEN 'poll' THEN 'Started a poll'
        ELSE left(coalesce(NEW.body, ''), 120)
      END;
      v_body := jsonb_build_object(
        'type', 'chat',
        'circleId', NEW.circle_id,
        'actorId', NEW.user_id,
        'preview', v_preview,
        'messageId', NEW.id
      );
    ELSE
      v_preview := left(coalesce(NEW.caption, ''), 120);
      v_body := jsonb_build_object(
        'type', 'kindle',
        'circleId', NEW.circle_id,
        'actorId', NEW.user_id,
        'preview', v_preview,
        'postId', NEW.id
      );
    END IF;

    PERFORM net.http_post(
      url := 'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/notify-crew-activity',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_auth
      ),
      body := v_body,
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'crew activity push skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_crew_social_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth text;
  v_body jsonb;
  v_author uuid;
  v_adder uuid := auth.uid();
BEGIN
  BEGIN
    SELECT substring(command from 'Bearer ([^"''[:space:]]+)')
      INTO v_auth
      FROM cron.job
      WHERE jobname = 'expire-opens'
      LIMIT 1;

    IF v_auth IS NULL OR length(v_auth) < 10 THEN
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'crew_message_reactions' THEN
      SELECT user_id INTO v_author FROM crew_messages WHERE id = NEW.message_id;
      IF v_author IS NULL OR v_author = NEW.user_id THEN
        RETURN NEW;
      END IF;
      v_body := jsonb_build_object(
        'type', 'message_reaction',
        'circleId', NEW.circle_id,
        'actorId', NEW.user_id,
        'targetUserId', v_author,
        'messageId', NEW.message_id,
        'preview', NEW.emoji
      );
    ELSE
      v_body := jsonb_build_object(
        'type', 'member_joined',
        'circleId', NEW.circle_id,
        'actorId', NEW.user_id
      );
      IF v_adder IS NOT NULL AND v_adder <> NEW.user_id THEN
        v_body := v_body || jsonb_build_object('addedBy', v_adder);
      END IF;
    END IF;

    PERFORM net.http_post(
      url := 'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/notify-crew-activity',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_auth
      ),
      body := v_body,
      timeout_milliseconds := 8000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'crew social push skipped: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- open_views: delete views on old Sparks in bounded batches that always make progress.
CREATE OR REPLACE FUNCTION purge_ephemeral_data()
RETURNS TABLE(media_url TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH doomed AS (
    DELETE FROM crew_posts
    WHERE id IN (
      SELECT id FROM crew_posts
      WHERE expires_at <= now()
      ORDER BY expires_at
      LIMIT 300
    )
    RETURNING crew_posts.photo_url
  )
  SELECT doomed.photo_url FROM doomed WHERE doomed.photo_url IS NOT NULL;

  RETURN QUERY
  WITH doomed AS (
    DELETE FROM crew_messages
    WHERE id IN (
      SELECT id FROM crew_messages
      WHERE expires_at <= now()
        AND crew_messages.media_url LIKE '%/object/public/crew-kindle/%'
      ORDER BY expires_at
      LIMIT 300
    )
    RETURNING crew_messages.media_url
  )
  SELECT doomed.media_url FROM doomed WHERE doomed.media_url IS NOT NULL;

  DELETE FROM crew_messages
  WHERE id IN (
    SELECT id FROM crew_messages
    WHERE expires_at <= now()
    ORDER BY expires_at
    LIMIT 500
  );

  DELETE FROM notification_logs
  WHERE id IN (
    SELECT id FROM notification_logs
    WHERE created_at < now() - INTERVAL '30 days'
    ORDER BY created_at
    LIMIT 500
  );

  DELETE FROM open_views
  WHERE ctid IN (
    SELECT v.ctid
    FROM open_views v
    JOIN opens o ON o.id = v.open_id
    WHERE o.status = 'expired' AND o.expires_at < now() - INTERVAL '1 day'
    LIMIT 2000
  );

  DELETE FROM opens
  WHERE id IN (
    SELECT id FROM opens
    WHERE status = 'expired' AND expires_at < now() - INTERVAL '30 days'
    ORDER BY expires_at
    LIMIT 200
  );

  DELETE FROM crew_activity_days
  WHERE day < (now() AT TIME ZONE 'UTC')::date - 90;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION purge_ephemeral_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_ephemeral_data() TO service_role;

-- Store renewals: re-check subscriptions near their end date.
DO $$
DECLARE
  v_auth text;
BEGIN
  SELECT substring(command from 'Bearer ([^"''[:space:]]+)')
    INTO v_auth
    FROM cron.job
    WHERE jobname = 'expire-opens'
    LIMIT 1;

  IF v_auth IS NULL OR length(v_auth) < 10 THEN
    RAISE NOTICE 'sync-subscriptions cron not scheduled: no expire-opens bearer';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-subscriptions') THEN
    PERFORM cron.unschedule('sync-subscriptions');
  END IF;

  PERFORM cron.schedule(
    'sync-subscriptions',
    '*/15 * * * *',
    format(
      $cmd$SELECT net.http_post(
        url := 'https://nszrdmnteckgukyobzfp.supabase.co/functions/v1/sync-subscriptions',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );$cmd$,
      v_auth
    )
  );
END $$;
