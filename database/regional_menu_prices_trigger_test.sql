-- ============================================================
-- 점메추 - 지역 평균가격 자동 갱신 트리거 테스트
-- ============================================================
--
-- 테스트 목적:
-- restaurant_menu_prices 에 검증 가격 3개가 한 번에 들어오면
-- regional_menu_prices 에
--
-- 1) 대전광역시 / 서구 평균
-- 2) 대전광역시 전체 평균
--
-- 이 자동 생성되는지 확인합니다.
--
-- 테스트 가격:
-- 10,000 / 10,500 / 11,200
--
-- 산술평균:
-- 10,566.666...
--
-- 500원 단위 올림:
-- 11,000원
--
-- 중요:
-- 마지막에 ROLLBACK 하므로
-- 테스트 데이터는 실제 DB에 남지 않습니다.
-- ============================================================


BEGIN;


-- ------------------------------------------------------------
-- 1. 테스트 가격 3개 삽입
-- ------------------------------------------------------------
INSERT INTO restaurant_menu_prices (
    restaurant_name,
    restaurant_address,
    menu_name,
    price_krw,
    source,
    confidence,
    observed_at,
    created_at,
    updated_at
)
VALUES
    (
        '점메추 트리거 테스트 A',
        '대전광역시 서구 둔산로 1',
        '__점메추_평균가격_테스트__',
        10000,
        'trigger_test',
        1.0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        '점메추 트리거 테스트 B',
        '대전광역시 서구 둔산로 2',
        '__점메추_평균가격_테스트__',
        10500,
        'trigger_test',
        1.0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        '점메추 트리거 테스트 C',
        '대전광역시 서구 둔산로 3',
        '__점메추_평균가격_테스트__',
        11200,
        'trigger_test',
        1.0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );


-- ------------------------------------------------------------
-- 2. 실제 가격 원본 확인
-- ------------------------------------------------------------
SELECT
    restaurant_name,
    restaurant_address,
    menu_name,
    price_krw,
    source

FROM restaurant_menu_prices

WHERE
    menu_name =
        '__점메추_평균가격_테스트__'

ORDER BY
    price_krw;


-- ------------------------------------------------------------
-- 3. 자동 생성된 지역 평균 확인
-- ------------------------------------------------------------
SELECT
    region1,
    region2,
    menu_name,
    average_price_krw,
    sample_count,
    source,
    reference_date

FROM regional_menu_prices

WHERE
    menu_name =
        '__점메추_평균가격_테스트__'

ORDER BY
    region2 NULLS LAST;


-- ------------------------------------------------------------
-- 4. 기대 결과 판정
-- ------------------------------------------------------------
SELECT
    CASE
        WHEN COUNT(*) FILTER (
            WHERE
                region1 = '대전광역시'
                AND region2 = '서구'
                AND average_price_krw = 11000
                AND sample_count = 3
                AND source = 'jummechu_verified_price_average'
        ) = 1

        AND COUNT(*) FILTER (
            WHERE
                region1 = '대전광역시'
                AND region2 IS NULL
                AND average_price_krw = 11000
                AND sample_count = 3
                AND source = 'jummechu_verified_price_average'
        ) = 1

        THEN 'PASS'

        ELSE 'FAIL'
    END AS trigger_test_result

FROM regional_menu_prices

WHERE
    menu_name =
        '__점메추_평균가격_테스트__';


-- ------------------------------------------------------------
-- 5. 테스트 데이터 원복
-- ------------------------------------------------------------
ROLLBACK;


-- ------------------------------------------------------------
-- 6. ROLLBACK 확인
-- ------------------------------------------------------------
SELECT
    COUNT(*) AS remaining_test_restaurant_prices

FROM restaurant_menu_prices

WHERE
    menu_name =
        '__점메추_평균가격_테스트__';


SELECT
    COUNT(*) AS remaining_test_regional_prices

FROM regional_menu_prices

WHERE
    menu_name =
        '__점메추_평균가격_테스트__';
