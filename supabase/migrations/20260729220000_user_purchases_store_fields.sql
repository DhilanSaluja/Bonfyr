-- Extend user_purchases for store subscriptions (Play + App Store)

ALTER TABLE user_purchases
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS environment TEXT;

COMMENT ON COLUMN user_purchases.platform IS 'google | apple';
COMMENT ON COLUMN user_purchases.environment IS 'production | sandbox';

CREATE INDEX IF NOT EXISTS user_purchases_user_active_idx
  ON user_purchases (user_id, product_id)
  WHERE purchase_state = 0;
