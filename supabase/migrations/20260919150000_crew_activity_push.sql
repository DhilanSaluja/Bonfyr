-- Chat / kindle push: fire from the database so iOS senders don't have to
-- keep a client request alive. Reuses the Bearer already on expire-opens cron.

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notification_logs_source_key_uidx
  ON notification_logs (source_key)
  WHERE source_key IS NOT NULL;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_messages_request_push ON crew_messages;
CREATE TRIGGER crew_messages_request_push
  AFTER INSERT ON crew_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.request_crew_activity_push();

DROP TRIGGER IF EXISTS crew_posts_request_push ON crew_posts;
CREATE TRIGGER crew_posts_request_push
  AFTER INSERT ON crew_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.request_crew_activity_push();
