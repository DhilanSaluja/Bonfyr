-- Ensure contacts matching works for signed-in users

GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION match_users_by_phone_hashes(p_hashes TEXT[])
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, phone_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hashes IS NULL OR cardinality(p_hashes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url, p.phone_hash
  FROM profiles p
  WHERE p.phone_hash = ANY (p_hashes)
    AND p.phone_hash IS NOT NULL
    AND p.id <> auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION match_users_by_phone_hashes(TEXT[]) TO authenticated;
