-- =========================================================
-- Jummechu - 영업시간 제보 / 관리자 승인 시스템
-- =========================================================

-- ---------------------------------------------------------
-- 1. 사용자 권한
-- ---------------------------------------------------------

ALTER TABLE users
ADD COLUMN IF NOT EXISTS
    role VARCHAR(20) NOT NULL DEFAULT 'user';


DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_ck'
    ) THEN

        ALTER TABLE users
        ADD CONSTRAINT users_role_ck
        CHECK (
            role IN (
                'user',
                'admin'
            )
        );

    END IF;
END $$;


CREATE INDEX IF NOT EXISTS
    idx_users_role
ON users(role);


-- ---------------------------------------------------------
-- 2. 영업시간 제보
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS
business_hours_reports (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    restaurant_key TEXT NOT NULL,

    restaurant_name TEXT NOT NULL,

    road_address TEXT NOT NULL,

    day_of_week SMALLINT NOT NULL
        CHECK (
            day_of_week BETWEEN 0 AND 6
        ),

    open_time TIME WITHOUT TIME ZONE,

    close_time TIME WITHOUT TIME ZONE,

    break_start_time TIME WITHOUT TIME ZONE,

    break_end_time TIME WITHOUT TIME ZONE,

    is_closed BOOLEAN NOT NULL
        DEFAULT FALSE,

    source_url TEXT,

    status VARCHAR(20) NOT NULL
        DEFAULT 'pending',

    reviewed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMPTZ,

    review_note TEXT,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    CONSTRAINT business_hours_reports_status_ck
        CHECK (
            status IN (
                'pending',
                'approved',
                'rejected'
            )
        ),

    CONSTRAINT business_hours_reports_open_close_ck
        CHECK (
            is_closed = TRUE
            OR (
                open_time IS NOT NULL
                AND close_time IS NOT NULL
            )
        ),

    CONSTRAINT business_hours_reports_break_ck
        CHECK (
            (
                break_start_time IS NULL
                AND break_end_time IS NULL
            )
            OR
            (
                break_start_time IS NOT NULL
                AND break_end_time IS NOT NULL
            )
        )
);


CREATE INDEX IF NOT EXISTS
    idx_business_hours_reports_status
ON business_hours_reports(
    status,
    created_at DESC
);


CREATE INDEX IF NOT EXISTS
    idx_business_hours_reports_restaurant
ON business_hours_reports(
    restaurant_key
);


CREATE INDEX IF NOT EXISTS
    idx_business_hours_reports_user
ON business_hours_reports(
    user_id,
    created_at DESC
);


-- 같은 사용자가 같은 가게/요일에
-- pending 제보를 여러 개 쌓지 않도록 합니다.
CREATE UNIQUE INDEX IF NOT EXISTS
    uniq_pending_business_hours_report
ON business_hours_reports(
    user_id,
    restaurant_key,
    day_of_week
)
WHERE status = 'pending';


COMMENT ON TABLE business_hours_reports IS
'User-submitted restaurant business hours pending administrator review.';


-- =========================================================
-- 관리자 지정 예시
-- 실제 이메일로 바꿔서 한 번만 실행하세요.
-- =========================================================

-- SELECT
--     id,
--     email,
--     name,
--     role
-- FROM users
-- ORDER BY id;

-- UPDATE users
-- SET role = 'admin'
-- WHERE email = 'YOUR_ADMIN_EMAIL@example.com';

-- SELECT
--     id,
--     email,
--     name,
--     role
-- FROM users
-- WHERE role = 'admin';
