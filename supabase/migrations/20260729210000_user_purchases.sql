-- Google Play Billing purchase records
-- Verified server-side by the verify-google-purchase Edge Function (service role upsert).
-- Clients may only read their own rows.

CREATE TABLE IF NOT EXISTS user_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  purchase_token TEXT NOT NULL UNIQUE,
  order_id TEXT,
  purchase_state INTEGER NOT NULL,
  is_acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_purchases_user_id_idx
  ON user_purchases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_purchases_product_id_idx
  ON user_purchases (user_id, product_id);

-- Keep updated_at fresh on every change
CREATE OR REPLACE FUNCTION set_user_purchases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_purchases_set_updated_at ON user_purchases;
CREATE TRIGGER user_purchases_set_updated_at
  BEFORE UPDATE ON user_purchases
  FOR EACH ROW
  EXECUTE FUNCTION set_user_purchases_updated_at();

ALTER TABLE user_purchases ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read only their own purchases.
-- Inserts/updates go through the Edge Function with the service role (bypasses RLS).
DROP POLICY IF EXISTS "Users can read own purchases" ON user_purchases;
CREATE POLICY "Users can read own purchases"
  ON user_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid());
