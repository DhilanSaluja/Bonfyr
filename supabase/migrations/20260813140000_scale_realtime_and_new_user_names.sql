-- Realtime for tables the app already listens to, plus OAuth display names.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE crew_posts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE crew_chat_reads;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), '');
  IF v_name IS NULL THEN
    v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'given_name'), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := 'Neighbor';
  END IF;

  INSERT INTO profiles (id, name)
  VALUES (NEW.id, LEFT(v_name, 48));

  INSERT INTO profile_private (user_id, phone)
  VALUES (NEW.id, NEW.phone)
  ON CONFLICT (user_id) DO UPDATE
    SET phone = COALESCE(EXCLUDED.phone, profile_private.phone);

  RETURN NEW;
END;
$$;
