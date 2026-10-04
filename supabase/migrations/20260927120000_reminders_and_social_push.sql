-- Fill the remaining push gaps:
--   * reactions on Crew chat messages  -> message author
--   * someone joins / is added to a Crew -> the Crew (and the person added)
--   * a Crew fire is about to go out    -> every member (sent from expire-opens cron)
-- Spark "burning out" reminders are sent from expire-opens and need no schema.

-- Circles whose last Spark / kindle / chat puts them p_hours_left from going out.
CREATE OR REPLACE FUNCTION circles_fire_dying(
  p_hours_left INTERVAL DEFAULT INTERVAL '3 hours',
  p_window INTERVAL DEFAULT INTERVAL '25 minutes'
)
RETURNS TABLE (
  circle_id UUID,
  circle_name TEXT,
  last_activity TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH activity AS (
    SELECT cp.circle_id, MAX(cp.created_at) AS last_at
    FROM crew_posts cp
    GROUP BY cp.circle_id

    UNION ALL

    SELECT cm.circle_id, MAX(cm.created_at) AS last_at
    FROM crew_messages cm
    GROUP BY cm.circle_id

    UNION ALL

    SELECT oc.circle_id, MAX(o.created_at) AS last_at
    FROM open_circles oc
    JOIN opens o ON o.id = oc.open_id
    GROUP BY oc.circle_id
  ),
  last_per_circle AS (
    SELECT a.circle_id, MAX(a.last_at) AS last_activity
    FROM activity a
    GROUP BY a.circle_id
  )
  SELECT
    c.id AS circle_id,
    c.name AS circle_name,
    l.last_activity
  FROM last_per_circle l
  JOIN circles c ON c.id = l.circle_id
  WHERE l.last_activity <= now() - (INTERVAL '24 hours' - p_hours_left)
    AND l.last_activity > now() - (INTERVAL '24 hours' - p_hours_left) - p_window;
$$;

REVOKE ALL ON FUNCTION circles_fire_dying(INTERVAL, INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION circles_fire_dying(INTERVAL, INTERVAL) TO service_role;

-- Same delivery path as request_crew_activity_push: reuse the Bearer on the
-- expire-opens cron job and let notify-crew-activity do the fan-out.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_message_reactions_request_push ON crew_message_reactions;
CREATE TRIGGER crew_message_reactions_request_push
  AFTER INSERT ON crew_message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.request_crew_social_push();

DROP TRIGGER IF EXISTS circle_members_request_push ON circle_members;
CREATE TRIGGER circle_members_request_push
  AFTER INSERT ON circle_members
  FOR EACH ROW
  EXECUTE FUNCTION public.request_crew_social_push();
