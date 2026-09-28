-- =========================================================
-- Jummechu v1 - restaurant business hours
--
-- restaurant_key 규칙:
--   app/api/restaurants/route.ts의 Restaurant.id와 동일
--   `${name}|${roadAddress || address}`
--
-- day_of_week:
--   0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
--
-- 주의:
-- NAVER 지역검색 API는 영업시간을 제공하지 않으므로
-- NAVER 스마트플레이스에서 확인한 값을 이 테이블에 저장합니다.
-- 실제 운영 전에는 source_url / verified_at을 함께 관리하세요.
-- =========================================================

CREATE TABLE IF NOT EXISTS restaurant_business_hours (
    id BIGSERIAL PRIMARY KEY,

    restaurant_key TEXT NOT NULL,

    restaurant_name TEXT NOT NULL,

    road_address TEXT,

    day_of_week SMALLINT NOT NULL
        CHECK (day_of_week BETWEEN 0 AND 6),

    open_time TIME WITHOUT TIME ZONE,

    close_time TIME WITHOUT TIME ZONE,

    break_start_time TIME WITHOUT TIME ZONE,

    break_end_time TIME WITHOUT TIME ZONE,

    is_closed BOOLEAN NOT NULL DEFAULT FALSE,

    source TEXT NOT NULL DEFAULT 'naver_smartplace_manual',

    source_url TEXT,

    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT restaurant_business_hours_restaurant_day_uq
        UNIQUE (restaurant_key, day_of_week),

    CONSTRAINT restaurant_business_hours_open_close_ck
        CHECK (
            is_closed = TRUE
            OR (
                open_time IS NOT NULL
                AND close_time IS NOT NULL
            )
        ),

    CONSTRAINT restaurant_business_hours_break_ck
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
    restaurant_business_hours_restaurant_key_idx
ON restaurant_business_hours (
    restaurant_key
);


CREATE INDEX IF NOT EXISTS
    restaurant_business_hours_verified_at_idx
ON restaurant_business_hours (
    verified_at DESC
);


COMMENT ON TABLE restaurant_business_hours IS
'Jummechu restaurant opening hours verified from NAVER SmartPlace or other approved manual sources.';

COMMENT ON COLUMN restaurant_business_hours.restaurant_key IS
'Must exactly match Restaurant.id: name|roadAddress-or-address.';

COMMENT ON COLUMN restaurant_business_hours.day_of_week IS
'0=Sunday, 1=Monday, ... 6=Saturday.';


-- =========================================================
-- 입력 예시
-- 아래 값은 형식 예시일 뿐 실제 영업시간이 아닙니다.
-- 실제 NAVER 스마트플레이스에서 확인한 값으로 바꿔 사용하세요.
-- =========================================================

-- INSERT INTO restaurant_business_hours (
--     restaurant_key,
--     restaurant_name,
--     road_address,
--     day_of_week,
--     open_time,
--     close_time,
--     break_start_time,
--     break_end_time,
--     is_closed,
--     source,
--     source_url,
--     verified_at
-- )
-- VALUES (
--     '가게명|도로명주소',
--     '가게명',
--     '도로명주소',
--     1,
--     '11:00',
--     '21:00',
--     '14:00',
--     '16:00',
--     FALSE,
--     'naver_smartplace_manual',
--     'https://map.naver.com/...',
--     NOW()
-- )
-- ON CONFLICT (
--     restaurant_key,
--     day_of_week
-- )
-- DO UPDATE SET
--     restaurant_name =
--         EXCLUDED.restaurant_name,
--
--     road_address =
--         EXCLUDED.road_address,
--
--     open_time =
--         EXCLUDED.open_time,
--
--     close_time =
--         EXCLUDED.close_time,
--
--     break_start_time =
--         EXCLUDED.break_start_time,
--
--     break_end_time =
--         EXCLUDED.break_end_time,
--
--     is_closed =
--         EXCLUDED.is_closed,
--
--     source =
--         EXCLUDED.source,
--
--     source_url =
--         EXCLUDED.source_url,
--
--     verified_at =
--         EXCLUDED.verified_at,
--
--     updated_at =
--         NOW();


-- =========================================================
-- 휴무일 입력 예시
-- =========================================================

-- INSERT INTO restaurant_business_hours (
--     restaurant_key,
--     restaurant_name,
--     road_address,
--     day_of_week,
--     is_closed,
--     source,
--     source_url,
--     verified_at
-- )
-- VALUES (
--     '가게명|도로명주소',
--     '가게명',
--     '도로명주소',
--     0,
--     TRUE,
--     'naver_smartplace_manual',
--     'https://map.naver.com/...',
--     NOW()
-- )
-- ON CONFLICT (
--     restaurant_key,
--     day_of_week
-- )
-- DO UPDATE SET
--     is_closed =
--         TRUE,
--
--     open_time =
--         NULL,
--
--     close_time =
--         NULL,
--
--     break_start_time =
--         NULL,
--
--     break_end_time =
--         NULL,
--
--     source =
--         EXCLUDED.source,
--
--     source_url =
--         EXCLUDED.source_url,
--
--     verified_at =
--         EXCLUDED.verified_at,
--
--     updated_at =
--         NOW();
