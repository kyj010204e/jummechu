BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_id BIGINT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
    source TEXT NOT NULL DEFAULT 'exploration',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT recommendation_feedback_user_food_uq UNIQUE (user_id, food_id)
);

CREATE INDEX IF NOT EXISTS recommendation_feedback_user_idx
ON recommendation_feedback (user_id, updated_at DESC);

COMMIT;
