-- Streaks and "fire went out" only need one span per person per crew per day,
-- not every photo, message, and Spark forever. Record that span, then the
-- minute cron can delete burned media and old history.

CREATE TABLE IF NOT EXISTS crew_activity_days (
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  first_at TIMESTAMPTZ NOT NULL,
  last_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (circle_id, user_id, day)
);

CREATE INDEX IF NOT EXISTS crew_activity_days_circle_day_idx
  ON crew_activity_days (circle_id, day DESC);

ALTER TABLE crew_activity_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_activity_days_select_member" ON crew_activity_days;
CREATE POLICY "crew_activity_days_select_member" ON crew_activity_days
  FOR SELECT TO authenticated
  USING (is_circle_member(circle_id));

CREATE OR REPLACE FUNCTION record_crew_activity(
  p_circle_id UUID,
  p_user_id UUID,
  p_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day DATE := (p_at AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_circle_id IS NULL OR p_user_id IS NULL OR p_at IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO crew_activity_days (circle_id, user_id, day, first_at, last_at)
  VALUES (p_circle_id, p_user_id, v_day, p_at, p_at)
  ON CONFLICT (circle_id, user_id, day) DO UPDATE
    SET first_at = LEAST(crew_activity_days.first_at, EXCLUDED.first_at),
        last_at = GREATEST(crew_activity_days.last_at, EXCLUDED.last_at);
END;
$$;

REVOKE ALL ON FUNCTION record_crew_activity(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trg_record_crew_row_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM record_crew_activity(NEW.circle_id, NEW.user_id, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crew_posts_record_activity ON crew_posts;
CREATE TRIGGER crew_posts_record_activity
  AFTER INSERT ON crew_posts
  FOR EACH ROW
  EXECUTE FUNCTION trg_record_crew_row_activity();

DROP TRIGGER IF EXISTS crew_messages_record_activity ON crew_messages;
CREATE TRIGGER crew_messages_record_activity
  AFTER INSERT ON crew_messages
  FOR EACH ROW
  EXECUTE FUNCTION trg_record_crew_row_activity();

CREATE OR REPLACE FUNCTION trg_record_spark_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator UUID;
  v_at TIMESTAMPTZ;
BEGIN
  SELECT creator_id, created_at INTO v_creator, v_at
  FROM opens
  WHERE id = NEW.open_id;

  PERFORM record_crew_activity(NEW.circle_id, v_creator, v_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS open_circles_record_activity ON open_circles;
CREATE TRIGGER open_circles_record_activity
  AFTER INSERT ON open_circles
  FOR EACH ROW
  EXECUTE FUNCTION trg_record_spark_activity();

-- Keep streaks across the deploy. first_at and last_at together cover the
-- local-day boundary that a single UTC timestamp would miss.
INSERT INTO crew_activity_days (circle_id, user_id, day, first_at, last_at)
SELECT circle_id, user_id, (created_at AT TIME ZONE 'UTC')::date, MIN(created_at), MAX(created_at)
FROM crew_posts
WHERE created_at > now() - INTERVAL '90 days'
GROUP BY circle_id, user_id, (created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (circle_id, user_id, day) DO UPDATE
  SET first_at = LEAST(crew_activity_days.first_at, EXCLUDED.first_at),
      last_at = GREATEST(crew_activity_days.last_at, EXCLUDED.last_at);

INSERT INTO crew_activity_days (circle_id, user_id, day, first_at, last_at)
SELECT circle_id, user_id, (created_at AT TIME ZONE 'UTC')::date, MIN(created_at), MAX(created_at)
FROM crew_messages
WHERE created_at > now() - INTERVAL '90 days'
GROUP BY circle_id, user_id, (created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (circle_id, user_id, day) DO UPDATE
  SET first_at = LEAST(crew_activity_days.first_at, EXCLUDED.first_at),
      last_at = GREATEST(crew_activity_days.last_at, EXCLUDED.last_at);

INSERT INTO crew_activity_days (circle_id, user_id, day, first_at, last_at)
SELECT oc.circle_id, o.creator_id, (o.created_at AT TIME ZONE 'UTC')::date,
       MIN(o.created_at), MAX(o.created_at)
FROM open_circles oc
JOIN opens o ON o.id = oc.open_id
WHERE o.created_at > now() - INTERVAL '90 days'
GROUP BY oc.circle_id, o.creator_id, (o.created_at AT TIME ZONE 'UTC')::date
ON CONFLICT (circle_id, user_id, day) DO UPDATE
  SET first_at = LEAST(crew_activity_days.first_at, EXCLUDED.first_at),
      last_at = GREATEST(crew_activity_days.last_at, EXCLUDED.last_at);

-- Fire alerts read the rollup, so deleting the posts does not hide a fire
-- that just went out.
CREATE OR REPLACE FUNCTION circles_fire_just_went_out(
  p_grace INTERVAL DEFAULT INTERVAL '25 minutes'
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
  WITH last_per_circle AS (
    SELECT d.circle_id, MAX(d.last_at) AS last_activity
    FROM crew_activity_days d
    GROUP BY d.circle_id
  )
  SELECT c.id, c.name, l.last_activity
  FROM last_per_circle l
  JOIN circles c ON c.id = l.circle_id
  WHERE l.last_activity <= now() - INTERVAL '24 hours'
    AND l.last_activity > now() - INTERVAL '24 hours' - p_grace;
$$;

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
  WITH last_per_circle AS (
    SELECT d.circle_id, MAX(d.last_at) AS last_activity
    FROM crew_activity_days d
    GROUP BY d.circle_id
  )
  SELECT c.id, c.name, l.last_activity
  FROM last_per_circle l
  JOIN circles c ON c.id = l.circle_id
  WHERE l.last_activity <= now() - (INTERVAL '24 hours' - p_hours_left)
    AND l.last_activity > now() - (INTERVAL '24 hours' - p_hours_left) - p_window;
$$;

-- One round trip for every crew fire on Home, instead of scanning months of
-- posts, messages, and Sparks down to the phone.
CREATE OR REPLACE FUNCTION crew_fire_bundle(p_circle_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
  v_since TIMESTAMPTZ := now() - INTERVAL '24 hours';
  v_day DATE := (now() AT TIME ZONE 'UTC')::date - 90;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(array_agg(c), '{}')
    INTO v_ids
  FROM unnest(COALESCE(p_circle_ids, '{}')) AS c
  WHERE is_circle_member(c);

  RETURN jsonb_build_object(
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'circle_id', d.circle_id,
        'user_id', d.user_id,
        'first_at', d.first_at,
        'last_at', d.last_at
      ))
      FROM crew_activity_days d
      WHERE d.circle_id = ANY(v_ids)
        AND d.day >= v_day
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'circle_id', c.id,
        'kindle_count', (
          SELECT count(*) FROM crew_posts p
          WHERE p.circle_id = c.id AND p.status = 'active' AND p.expires_at > now()
        ),
        'chat_count', (
          SELECT count(*) FROM crew_messages m
          WHERE m.circle_id = c.id AND m.created_at > v_since
        ),
        'spark_count', (
          SELECT count(*) FROM open_circles oc
          JOIN opens o ON o.id = oc.open_id
          WHERE oc.circle_id = c.id AND o.created_at > v_since
        ),
        'active_user_ids', (
          SELECT COALESCE(jsonb_agg(DISTINCT people.u), '[]'::jsonb)
          FROM (
            SELECT p.user_id AS u FROM crew_posts p
            WHERE p.circle_id = c.id AND p.status = 'active' AND p.expires_at > now()
            UNION
            SELECT m.user_id FROM crew_messages m
            WHERE m.circle_id = c.id AND m.created_at > v_since
            UNION
            SELECT o.creator_id FROM open_circles oc
            JOIN opens o ON o.id = oc.open_id
            WHERE oc.circle_id = c.id AND o.created_at > v_since
          ) people
        )
      ))
      FROM unnest(v_ids) AS c(id)
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION crew_fire_bundle(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crew_fire_bundle(UUID[]) TO authenticated;

CREATE INDEX IF NOT EXISTS crew_posts_expires_idx ON crew_posts (expires_at);
CREATE INDEX IF NOT EXISTS notification_logs_created_idx ON notification_logs (created_at);
CREATE INDEX IF NOT EXISTS opens_expired_idx ON opens (expires_at)
  WHERE status = 'expired';

-- Bounded so one cron minute cannot lock the database on a large backlog.
-- The next minute continues where this one stopped.
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
        AND media_url LIKE '%/object/public/crew-kindle/%'
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
  WHERE open_id IN (
    SELECT id FROM opens
    WHERE status = 'expired' AND expires_at < now() - INTERVAL '1 day'
    LIMIT 200
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

REVOKE ALL ON FUNCTION purge_ephemeral_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_ephemeral_data() TO service_role;
