-- Presence status shown on crew fire rings ("Studying", "Late night drive", …)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status_text TEXT,
  ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.status_text IS 'What the user is doing right now (shown on crew avatars)';
COMMENT ON COLUMN profiles.status_at IS 'When status_text was last set; fades after 24h';
