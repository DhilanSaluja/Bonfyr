-- Bonfyr — Core Schema
-- Run via: supabase db push

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE subscription_tier AS ENUM ('free', 'pro');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'expired', 'trialing');
CREATE TYPE open_status AS ENUM ('active', 'expired', 'scheduled');
CREATE TYPE location_mode AS ENUM ('none', 'general', 'precise');
CREATE TYPE circle_add_policy AS ENUM ('anyone', 'contacts_only', 'invite_only');

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  phone_hash TEXT UNIQUE,
  avatar_url TEXT,
  subscription_tier subscription_tier NOT NULL DEFAULT 'free',
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  subscription_expires_at TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  push_token TEXT,
  favorite_contact_ids UUID[] DEFAULT '{}',
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  circle_add_policy circle_add_policy NOT NULL DEFAULT 'invite_only',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Circles
CREATE TABLE circles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT '#C17B5C',
  photo_url TEXT,
  invite_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE circle_members (
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE TABLE muted_circles (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, circle_id)
);

-- Opens
CREATE TABLE opens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location_mode location_mode NOT NULL DEFAULT 'none',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  fuzzed_latitude DOUBLE PRECISION,
  fuzzed_longitude DOUBLE PRECISION,
  expires_at TIMESTAMPTZ NOT NULL,
  scheduled_for TIMESTAMPTZ,
  status open_status NOT NULL DEFAULT 'active',
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE open_circles (
  open_id UUID NOT NULL REFERENCES opens(id) ON DELETE CASCADE,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  PRIMARY KEY (open_id, circle_id)
);

CREATE TABLE open_joiners (
  open_id UUID NOT NULL REFERENCES opens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (open_id, user_id)
);

CREATE TABLE open_views (
  open_id UUID NOT NULL REFERENCES opens(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (open_id, user_id)
);

-- Notification logs
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  open_id UUID REFERENCES opens(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription records (Stripe sync)
CREATE TABLE subscription_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  status subscription_status NOT NULL,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_opens_status_expires ON opens(status, expires_at);
CREATE INDEX idx_opens_creator ON opens(creator_id);
CREATE INDEX idx_circle_members_user ON circle_members(user_id);
CREATE INDEX idx_open_circles_circle ON open_circles(circle_id);
CREATE INDEX idx_profiles_phone_hash ON profiles(phone_hash);
CREATE INDEX idx_notification_logs_user ON notification_logs(user_id, created_at DESC);

-- View count trigger (aggregate only)
CREATE OR REPLACE FUNCTION increment_open_view_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE opens SET view_count = view_count + 1 WHERE id = NEW.open_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_open_view_insert
  AFTER INSERT ON open_views
  FOR EACH ROW EXECUTE FUNCTION increment_open_view_count();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, phone, name)
  VALUES (
    NEW.id,
    NEW.phone,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Neighbor')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Circle creation with free-tier limit (server-side enforcement)
CREATE OR REPLACE FUNCTION create_circle_with_limit(
  p_name TEXT,
  p_color TEXT,
  p_owner_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_tier subscription_tier;
  v_count INTEGER;
  v_circle_id UUID;
BEGIN
  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = p_owner_id;

  SELECT COUNT(*) INTO v_count FROM circles WHERE owner_id = p_owner_id;

  IF v_tier = 'free' AND v_count >= 5 THEN
    RAISE EXCEPTION 'Free tier limited to 5 circles. Upgrade to Pro for unlimited.';
  END IF;

  INSERT INTO circles (name, color, owner_id)
  VALUES (p_name, p_color, p_owner_id)
  RETURNING id INTO v_circle_id;

  INSERT INTO circle_members (circle_id, user_id)
  VALUES (v_circle_id, p_owner_id);

  RETURN v_circle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user can post to circle (free tier: first 5 circles only)
CREATE OR REPLACE FUNCTION can_post_to_circle(p_user_id UUID, p_circle_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_tier subscription_tier;
  v_circle_rank INTEGER;
BEGIN
  SELECT subscription_tier INTO v_tier FROM profiles WHERE id = p_user_id;
  IF v_tier = 'pro' THEN RETURN true; END IF;

  SELECT rn INTO v_circle_rank FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
    FROM circles c
    WHERE EXISTS (
      SELECT 1 FROM circle_members cm
      WHERE cm.circle_id = c.id AND cm.user_id = p_user_id
    )
  ) ranked WHERE id = p_circle_id;

  RETURN COALESCE(v_circle_rank, 999) <= 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Match users by phone hashes (contacts sync — no raw contact upload)
CREATE OR REPLACE FUNCTION match_users_by_phone_hashes(p_hashes TEXT[])
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, phone_hash TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url, p.phone_hash
  FROM profiles p
  WHERE p.phone_hash = ANY(p_hashes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Expire opens (called by cron)
CREATE OR REPLACE FUNCTION expire_stale_opens()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE opens
  SET status = 'expired'
  WHERE status IN ('active', 'scheduled')
    AND expires_at <= now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Activate scheduled opens
CREATE OR REPLACE FUNCTION activate_scheduled_opens()
RETURNS SETOF UUID AS $$
BEGIN
  RETURN QUERY
  UPDATE opens
  SET status = 'active'
  WHERE status = 'scheduled'
    AND scheduled_for <= now()
    AND expires_at > now()
  RETURNING id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE muted_circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE opens ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_joiners ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_records ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can view circle member profiles" ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM circle_members cm1
      JOIN circle_members cm2 ON cm1.circle_id = cm2.circle_id
      WHERE cm1.user_id = auth.uid() AND cm2.user_id = profiles.id
    )
  );

-- Circles policies
CREATE POLICY "Members can view their circles" ON circles FOR SELECT
  USING (EXISTS (SELECT 1 FROM circle_members WHERE circle_id = circles.id AND user_id = auth.uid()));

CREATE POLICY "Owner can update circle" ON circles FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Owner can delete circle" ON circles FOR DELETE
  USING (owner_id = auth.uid());

-- Circle members
CREATE POLICY "Members can view circle membership" ON circle_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = circle_members.circle_id AND cm.user_id = auth.uid()));

CREATE POLICY "Owner can remove members" ON circle_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM circles WHERE id = circle_members.circle_id AND owner_id = auth.uid()));

CREATE POLICY "Users can leave circles" ON circle_members FOR DELETE
  USING (user_id = auth.uid());

-- Opens: only circle members see opens posted to their circles
CREATE POLICY "Circle members see opens" ON opens FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM open_circles oc
      JOIN circle_members cm ON cm.circle_id = oc.circle_id
      WHERE oc.open_id = opens.id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Creators can insert opens" ON opens FOR INSERT
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creators can update own opens" ON opens FOR UPDATE
  USING (creator_id = auth.uid());

-- Open circles
CREATE POLICY "Members see open_circles" ON open_circles FOR SELECT
  USING (EXISTS (SELECT 1 FROM circle_members WHERE circle_id = open_circles.circle_id AND user_id = auth.uid()));

CREATE POLICY "Creators can link opens to circles" ON open_circles FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM opens WHERE id = open_circles.open_id AND creator_id = auth.uid())
    AND can_post_to_circle(auth.uid(), open_circles.circle_id)
  );

-- Joiners
CREATE POLICY "Members see joiners" ON open_joiners FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM open_circles oc
      JOIN circle_members cm ON cm.circle_id = oc.circle_id
      WHERE oc.open_id = open_joiners.open_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join opens" ON open_joiners FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Views (Pro creators see aggregate count via opens.view_count)
CREATE POLICY "Users can record views" ON open_views FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Muted circles
CREATE POLICY "Users manage own mutes" ON muted_circles FOR ALL
  USING (user_id = auth.uid());

-- Notifications
CREATE POLICY "Users see own notifications" ON notification_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications" ON notification_logs FOR UPDATE
  USING (user_id = auth.uid());

-- Subscriptions
CREATE POLICY "Users see own subscription" ON subscription_records FOR SELECT
  USING (user_id = auth.uid());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE opens;
ALTER PUBLICATION supabase_realtime ADD TABLE open_joiners;

-- Cron jobs (requires pg_cron extension on Supabase Pro, or use edge function cron)
-- SELECT cron.schedule('expire-opens', '* * * * *', 'SELECT expire_stale_opens()');
-- SELECT cron.schedule('activate-scheduled', '* * * * *', 'SELECT activate_scheduled_opens()');
