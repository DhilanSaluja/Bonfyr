-- Ephemeral crew kindling: photo posts that burn out after 24 hours

CREATE TABLE IF NOT EXISTS crew_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired'))
);

CREATE INDEX IF NOT EXISTS crew_posts_circle_active_idx
  ON crew_posts (circle_id, expires_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS crew_posts_user_idx
  ON crew_posts (user_id, created_at DESC);

ALTER TABLE crew_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read crew posts" ON crew_posts;
CREATE POLICY "Members can read crew posts"
  ON crew_posts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM circle_members cm
      WHERE cm.circle_id = crew_posts.circle_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can create crew posts" ON crew_posts;
CREATE POLICY "Members can create crew posts"
  ON crew_posts FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM circle_members cm
      WHERE cm.circle_id = crew_posts.circle_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Authors can delete their crew posts" ON crew_posts;
CREATE POLICY "Authors can delete their crew posts"
  ON crew_posts FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Mark expired posts (call from cron or client-side filter)
CREATE OR REPLACE FUNCTION expire_stale_crew_posts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE crew_posts
  SET status = 'expired'
  WHERE status = 'active'
    AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Storage for kindling photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crew-kindle',
  'crew-kindle',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Kindle photos are publicly accessible" ON storage.objects;
CREATE POLICY "Kindle photos are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crew-kindle');

DROP POLICY IF EXISTS "Members can upload kindle photos" ON storage.objects;
CREATE POLICY "Members can upload kindle photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crew-kindle'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Members can update kindle photos" ON storage.objects;
CREATE POLICY "Members can update kindle photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crew-kindle'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'crew-kindle'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Members can delete kindle photos" ON storage.objects;
CREATE POLICY "Members can delete kindle photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'crew-kindle'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
