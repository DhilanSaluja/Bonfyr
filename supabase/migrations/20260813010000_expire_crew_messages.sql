-- Permanently delete Crew chat messages after 24 hours.
CREATE OR REPLACE FUNCTION expire_stale_crew_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM crew_messages
  WHERE expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_stale_crew_messages() TO authenticated;
GRANT EXECUTE ON FUNCTION expire_stale_crew_messages() TO service_role;

SELECT expire_stale_crew_messages();
