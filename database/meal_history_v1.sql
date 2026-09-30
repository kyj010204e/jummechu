CREATE TABLE IF NOT EXISTS meal_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_attempt_id TEXT NOT NULL,
  restaurant_key TEXT NOT NULL,
  restaurant_name TEXT NOT NULL,
  road_address TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  food_id BIGINT REFERENCES foods(id) ON DELETE SET NULL,
  menu_name TEXT,
  source TEXT NOT NULL DEFAULT 'recommendation',
  rating SMALLINT CHECK (rating IN (-1, 1)),
  private_comment TEXT NOT NULL DEFAULT '',
  tried_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기존 테이블 업그레이드용
ALTER TABLE meal_history
ADD COLUMN IF NOT EXISTS private_comment TEXT NOT NULL DEFAULT '';

ALTER TABLE meal_history
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS meal_history_user_attempt_uq
ON meal_history (user_id, client_attempt_id);

CREATE INDEX IF NOT EXISTS meal_history_user_tried_idx
ON meal_history (user_id, tried_at DESC);

CREATE INDEX IF NOT EXISTS meal_history_user_restaurant_idx
ON meal_history (user_id, restaurant_key, tried_at DESC);

COMMENT ON COLUMN meal_history.private_comment IS
'Private note visible only to the owner. Reserved for possible future review feature.';
