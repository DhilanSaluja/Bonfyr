-- Kindle media: videos + fire reactions + comments

ALTER TABLE crew_posts
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'
    CHECK (media_type IN ('image', 'video'));

-- Fire reactions (one 🔥 per member per post)
CREATE TABLE IF NOT EXISTS crew_post_reactions (
  post_id UUID NOT NULL REFERENCES crew_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL DEFAULT '🔥',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS crew_post_reactions_post_idx
  ON crew_post_reactions (post_id);

ALTER TABLE crew_post_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read crew post reactions" ON crew_post_reactions;
CREATE POLICY "Members can read crew post reactions"
  ON crew_post_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM crew_posts p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = crew_post_reactions.post_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can react to crew posts" ON crew_post_reactions;
CREATE POLICY "Members can react to crew posts"
  ON crew_post_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM crew_posts p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = crew_post_reactions.post_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can remove their reactions" ON crew_post_reactions;
CREATE POLICY "Members can remove their reactions"
  ON crew_post_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Comments on kindle posts
CREATE TABLE IF NOT EXISTS crew_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES crew_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0 AND char_length(body) <= 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crew_post_comments_post_idx
  ON crew_post_comments (post_id, created_at ASC);

ALTER TABLE crew_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read crew post comments" ON crew_post_comments;
CREATE POLICY "Members can read crew post comments"
  ON crew_post_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM crew_posts p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = crew_post_comments.post_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Members can comment on crew posts" ON crew_post_comments;
CREATE POLICY "Members can comment on crew posts"
  ON crew_post_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM crew_posts p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = crew_post_comments.post_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Authors can delete their comments" ON crew_post_comments;
CREATE POLICY "Authors can delete their comments"
  ON crew_post_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Allow short videos in kindle bucket (50 MB)
UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
WHERE id = 'crew-kindle';
