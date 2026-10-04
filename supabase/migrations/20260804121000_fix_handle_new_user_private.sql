-- handle_new_user still inserted phone into profiles after the privacy split.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Neighbor')
  );

  INSERT INTO profile_private (user_id, phone)
  VALUES (NEW.id, NEW.phone)
  ON CONFLICT (user_id) DO UPDATE
    SET phone = COALESCE(EXCLUDED.phone, profile_private.phone);

  RETURN NEW;
END;
$$;
