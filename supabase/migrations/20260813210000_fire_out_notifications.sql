-- Deep-link quiet-hour flushes + detect crew fires that just went out.

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS circle_id UUID REFERENCES circles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_circle_type
  ON notification_logs(circle_id, type, created_at DESC);

-- Circles whose last Spark / kindle / chat fell just past the 24h window.
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
  WHERE l.last_activity <= now() - INTERVAL '24 hours'
    AND l.last_activity > now() - INTERVAL '24 hours' - p_grace;
$$;

GRANT EXECUTE ON FUNCTION circles_fire_just_went_out(INTERVAL) TO service_role;
