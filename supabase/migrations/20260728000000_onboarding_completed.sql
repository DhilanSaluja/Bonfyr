-- Track whether the user finished the post-signup welcome (name + contacts) flow

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Existing users who already picked a real name are treated as onboarded
UPDATE profiles
SET onboarding_completed_at = COALESCE(updated_at, created_at, now())
WHERE onboarding_completed_at IS NULL
  AND name IS NOT NULL
  AND trim(name) <> ''
  AND trim(name) NOT IN ('Friend', 'Neighbor');
