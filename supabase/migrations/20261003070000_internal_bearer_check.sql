-- The cron job and DB triggers authenticate with the bearer stored on the
-- expire-opens job. Edge functions ask the database whether a token matches
-- instead of keeping their own copy that can drift when keys rotate.
CREATE OR REPLACE FUNCTION is_internal_bearer(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_token IS NOT NULL
    AND length(p_token) >= 20
    AND EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'expire-opens'
        AND substring(command from 'Bearer ([^"''[:space:]]+)') = p_token
    );
$$;

REVOKE ALL ON FUNCTION is_internal_bearer(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_internal_bearer(TEXT) TO service_role;
