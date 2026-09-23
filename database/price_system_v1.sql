-- ============================================================
-- 점메추 가격 시스템 v1
-- ============================================================
--
-- 구조
--
-- restaurant_menu_prices
--   검증된 현재 음식점 메뉴 가격
--
-- regional_menu_prices
--   실제 가격이 없을 때 사용하는 지역 평균가
--
-- price_reports
--   로그인 사용자의 가격 제보
--
-- price_report_evidence
--   메뉴판/영수증 등 증빙
--
-- restaurant_menu_price_history
--   검증된 가격 변경 이력
--
-- user_price_reputation
--   가격 제보 사용자 신뢰도/통계
-- ============================================================


BEGIN;


-- ============================================================
-- 1. 검증된 현재 가격
-- ============================================================

CREATE TABLE IF NOT EXISTS
restaurant_menu_prices (
    id BIGSERIAL PRIMARY KEY,

    restaurant_name VARCHAR(200) NOT NULL,

    restaurant_address TEXT,

    menu_name VARCHAR(200) NOT NULL,

    price_krw INTEGER NOT NULL,

    source VARCHAR(50) NOT NULL
        DEFAULT 'direct',

    confidence DOUBLE PRECISION NOT NULL
        DEFAULT 1.0,

    source_url TEXT,

    observed_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        price_krw > 0
    ),

    CHECK (
        confidence >= 0
        AND confidence <= 1
    )
);


CREATE INDEX IF NOT EXISTS
idx_restaurant_menu_prices_name
ON restaurant_menu_prices(
    restaurant_name
);


CREATE INDEX IF NOT EXISTS
idx_restaurant_menu_prices_menu
ON restaurant_menu_prices(
    menu_name
);


-- ============================================================
-- 2. 지역 평균가
-- ============================================================

CREATE TABLE IF NOT EXISTS
regional_menu_prices (
    id BIGSERIAL PRIMARY KEY,

    region1 VARCHAR(50) NOT NULL,

    region2 VARCHAR(50),

    menu_name VARCHAR(200) NOT NULL,

    average_price_krw INTEGER NOT NULL,

    sample_count INTEGER,

    source VARCHAR(100) NOT NULL,

    reference_date DATE,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        average_price_krw > 0
    )
);


CREATE INDEX IF NOT EXISTS
idx_regional_menu_prices_region
ON regional_menu_prices(
    region1,
    region2
);


CREATE INDEX IF NOT EXISTS
idx_regional_menu_prices_menu
ON regional_menu_prices(
    menu_name
);


-- reference_date가 NULL일 수도 있으므로
-- COALESCE 기반 unique index를 사용합니다.
-- PostgreSQL 14 이하에서도 동작하도록 작성했습니다.
CREATE UNIQUE INDEX IF NOT EXISTS
uniq_regional_menu_price
ON regional_menu_prices (
    region1,
    COALESCE(region2, ''),
    menu_name,
    COALESCE(
        reference_date,
        DATE '1900-01-01'
    )
);


-- ============================================================
-- 3. 사용자 가격 제보
-- ============================================================

CREATE TABLE IF NOT EXISTS
price_reports (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    restaurant_menu_price_id BIGINT
        REFERENCES restaurant_menu_prices(id)
        ON DELETE SET NULL,

    restaurant_name VARCHAR(200) NOT NULL,

    restaurant_address TEXT,

    menu_name VARCHAR(200) NOT NULL,

    reported_price_krw INTEGER NOT NULL,

    previous_price_krw INTEGER,

    note TEXT,

    status VARCHAR(20) NOT NULL
        DEFAULT 'pending',

    confidence DOUBLE PRECISION NOT NULL
        DEFAULT 0.0,

    reviewed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    reviewed_at TIMESTAMP,

    review_note TEXT,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        reported_price_krw > 0
    ),

    CHECK (
        previous_price_krw IS NULL
        OR previous_price_krw > 0
    ),

    CHECK (
        confidence >= 0
        AND confidence <= 1
    ),

    CHECK (
        status IN (
            'pending',
            'approved',
            'rejected',
            'merged'
        )
    )
);


CREATE INDEX IF NOT EXISTS
idx_price_reports_user
ON price_reports(
    user_id
);


CREATE INDEX IF NOT EXISTS
idx_price_reports_status
ON price_reports(
    status
);


CREATE INDEX IF NOT EXISTS
idx_price_reports_restaurant
ON price_reports(
    restaurant_name
);


CREATE INDEX IF NOT EXISTS
idx_price_reports_menu
ON price_reports(
    menu_name
);


-- 한 사용자가 동일 음식점/동일 메뉴에
-- pending 제보를 여러 개 만드는 것을 방지.
--
-- lower()를 사용해서 대소문자 차이도 동일하게 취급.
CREATE UNIQUE INDEX IF NOT EXISTS
uniq_pending_price_report
ON price_reports (
    user_id,
    LOWER(restaurant_name),
    LOWER(menu_name)
)
WHERE status = 'pending';


-- ============================================================
-- 4. 가격 제보 증빙
-- ============================================================

CREATE TABLE IF NOT EXISTS
price_report_evidence (
    id BIGSERIAL PRIMARY KEY,

    report_id BIGINT NOT NULL
        REFERENCES price_reports(id)
        ON DELETE CASCADE,

    evidence_type VARCHAR(30) NOT NULL,

    file_url TEXT NOT NULL,

    created_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        evidence_type IN (
            'menu_photo',
            'receipt',
            'store_photo',
            'other'
        )
    )
);


CREATE INDEX IF NOT EXISTS
idx_price_report_evidence_report
ON price_report_evidence(
    report_id
);


-- ============================================================
-- 5. 가격 변경 이력
-- ============================================================

CREATE TABLE IF NOT EXISTS
restaurant_menu_price_history (
    id BIGSERIAL PRIMARY KEY,

    restaurant_menu_price_id BIGINT NOT NULL
        REFERENCES restaurant_menu_prices(id)
        ON DELETE CASCADE,

    old_price_krw INTEGER,

    new_price_krw INTEGER NOT NULL,

    source VARCHAR(50) NOT NULL,

    report_id BIGINT
        REFERENCES price_reports(id)
        ON DELETE SET NULL,

    changed_by BIGINT
        REFERENCES users(id)
        ON DELETE SET NULL,

    changed_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        old_price_krw IS NULL
        OR old_price_krw > 0
    ),

    CHECK (
        new_price_krw > 0
    )
);


CREATE INDEX IF NOT EXISTS
idx_menu_price_history_price
ON restaurant_menu_price_history(
    restaurant_menu_price_id
);


-- ============================================================
-- 6. 가격 제보 사용자 평판
-- ============================================================

CREATE TABLE IF NOT EXISTS
user_price_reputation (
    user_id BIGINT PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    trust_score INTEGER NOT NULL
        DEFAULT 0,

    total_reports INTEGER NOT NULL
        DEFAULT 0,

    approved_reports INTEGER NOT NULL
        DEFAULT 0,

    rejected_reports INTEGER NOT NULL
        DEFAULT 0,

    evidence_reports INTEGER NOT NULL
        DEFAULT 0,

    updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        trust_score >= 0
    ),

    CHECK (
        total_reports >= 0
    ),

    CHECK (
        approved_reports >= 0
    ),

    CHECK (
        rejected_reports >= 0
    ),

    CHECK (
        evidence_reports >= 0
    )
);


COMMIT;
