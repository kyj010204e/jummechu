-- ============================================================
-- 점메추 - 대전광역시 외식 평균가격 seed
-- ============================================================
--
-- 기준:
-- 한국소비자원 참가격 > 외식비
-- 제공자료: 행정안전부 외식비 가격정보
--
-- 이 파일은 "추천 점수"에 가격을 넣기 위한 것이 아닙니다.
-- 가격 표시 + 예산맞춤 필터에만 사용합니다.
--
-- region2 = NULL:
--   대전광역시 전체 평균값이므로 서구/유성구/중구 등 모든 구에서
--   지역 평균 fallback으로 사용할 수 있습니다.
--
-- reference_date = NULL:
--   참가격 페이지가 "최신 데이터"를 기본 노출하지만
--   현재 seed 작성 시점에 원자료의 정확한 기준월을 별도로 확정하지
--   않았으므로 임의의 월을 기록하지 않습니다.
--
-- source 문자열에 2026-09-29 조회일을 남깁니다.
--
-- 주의:
-- '일반비빔밥', '일반김밥', '물냉면'은 점메추 Food Master 이름과
-- 연결하기 위한 호환 alias입니다.
-- ============================================================

BEGIN;


-- ------------------------------------------------------------
-- 1. seed 데이터
-- ------------------------------------------------------------
CREATE TEMP TABLE tmp_daejeon_menu_price_seed (
    menu_name VARCHAR(200) PRIMARY KEY,
    average_price_krw INTEGER NOT NULL,
    source VARCHAR(100) NOT NULL
) ON COMMIT DROP;


INSERT INTO tmp_daejeon_menu_price_seed (
    menu_name,
    average_price_krw,
    source
)
VALUES
    -- 참가격 공식 품목명
    (
        '냉면',
        11200,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '비빔밥',
        10700,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '김치찌개백반',
        10600,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '삼겹살',
        18600,
        'KCA TruePrice/MOIS latest; 200g converted; fetched 2026-09-29'
    ),
    (
        '자장면',
        7600,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '삼계탕',
        16800,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '칼국수',
        8800,
        'KCA TruePrice/MOIS latest; fetched 2026-09-29'
    ),
    (
        '김밥',
        3300,
        'KCA TruePrice/MOIS latest; 1 roll; fetched 2026-09-29'
    ),

    -- --------------------------------------------------------
    -- 점메추 Food Master 호환 alias
    --
    -- 공식 품목과 의미가 매우 가까운 이름만 연결합니다.
    -- 해물칼국수처럼 추가 재료로 단가가 달라질 수 있는 메뉴는
    -- 일부러 alias 처리하지 않습니다.
    -- --------------------------------------------------------
    (
        '물냉면',
        11200,
        'KCA TruePrice/MOIS latest; alias of 냉면; fetched 2026-09-29'
    ),
    (
        '일반비빔밥',
        10700,
        'KCA TruePrice/MOIS latest; alias of 비빔밥; fetched 2026-09-29'
    ),
    (
        '일반김밥',
        3300,
        'KCA TruePrice/MOIS latest; alias of 김밥; fetched 2026-09-29'
    );


-- ------------------------------------------------------------
-- 2. 기존 NULL-reference 대전 평균가가 있으면 갱신
-- ------------------------------------------------------------
UPDATE regional_menu_prices AS target
SET
    average_price_krw =
        seed.average_price_krw,

    sample_count =
        NULL,

    source =
        seed.source,

    reference_date =
        NULL,

    updated_at =
        CURRENT_TIMESTAMP

FROM tmp_daejeon_menu_price_seed AS seed

WHERE
    target.region1 =
        '대전광역시'

    AND target.region2
        IS NULL

    AND target.menu_name =
        seed.menu_name

    AND target.reference_date
        IS NULL;


-- ------------------------------------------------------------
-- 3. 없는 메뉴는 신규 삽입
-- ------------------------------------------------------------
INSERT INTO regional_menu_prices (
    region1,
    region2,
    menu_name,
    average_price_krw,
    sample_count,
    source,
    reference_date,
    created_at,
    updated_at
)
SELECT
    '대전광역시',

    NULL,

    seed.menu_name,

    seed.average_price_krw,

    NULL,

    seed.source,

    NULL,

    CURRENT_TIMESTAMP,

    CURRENT_TIMESTAMP

FROM tmp_daejeon_menu_price_seed AS seed

WHERE NOT EXISTS (
    SELECT 1

    FROM regional_menu_prices AS existing

    WHERE
        existing.region1 =
            '대전광역시'

        AND existing.region2
            IS NULL

        AND existing.menu_name =
            seed.menu_name

        AND existing.reference_date
            IS NULL
);


COMMIT;


-- ============================================================
-- 확인
-- ============================================================
SELECT
    region1,
    region2,
    menu_name,
    average_price_krw,
    source,
    reference_date,
    updated_at

FROM regional_menu_prices

WHERE
    region1 =
        '대전광역시'

    AND menu_name IN (
        '냉면',
        '물냉면',
        '비빔밥',
        '일반비빔밥',
        '김치찌개백반',
        '삼겹살',
        '자장면',
        '삼계탕',
        '칼국수',
        '김밥',
        '일반김밥'
    )

ORDER BY
    menu_name;
