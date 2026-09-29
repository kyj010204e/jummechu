-- ============================================================
-- 점메추 - 지역 평균가격 자동 갱신 v1
-- ============================================================
--
-- 목표
-- 1) 모든 "평균가격"은 500원 단위 올림
--    4,300 -> 4,500
--    4,900 -> 5,000
--    5,000 -> 5,000
--
-- 2) restaurant_menu_prices 에 검증된 실제 가격이 쌓이면
--    지역별 메뉴 평균가격을 자동 계산
--
-- 3) 표본이 3개 이상일 때만 점메추 자체 평균으로 사용
--
-- 4) 구/시/군 단위 평균 + 광역시/특별시/도 단위 평균을 모두 생성
--
-- 5) 기존 공공 평균가격은 삭제하지 않음
--    점메추 자체 평균(source = jummechu_verified_price_average)만
--    매번 다시 계산
--
-- 주의
-- restaurant_menu_prices 는 "검증된 현재 가격" 테이블이므로
-- pending 제보(price_reports)는 평균에 포함하지 않습니다.
-- ============================================================


BEGIN;


-- ============================================================
-- 1. 500원 단위 올림 함수
-- ============================================================

CREATE OR REPLACE FUNCTION round_price_up_500(
    p_price NUMERIC
)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
    SELECT
        (
            CEIL(
                p_price /
                500.0
            ) *
            500
        )::INTEGER;
$$;


COMMENT ON FUNCTION round_price_up_500(NUMERIC) IS
'Rounds an average price upward to the next 500 KRW unit. 4300->4500, 4900->5000.';


-- ============================================================
-- 2. 기존 regional_menu_prices도 500원 단위로 정리
-- ============================================================
--
-- 실제 개별 메뉴 가격은 건드리지 않습니다.
-- "평균가격" 테이블만 500원 단위로 표시/필터링되도록 정리합니다.
-- ============================================================

UPDATE regional_menu_prices
SET
    average_price_krw =
        round_price_up_500(
            average_price_krw
        ),

    updated_at =
        CURRENT_TIMESTAMP

WHERE
    average_price_krw
    <>
    round_price_up_500(
        average_price_krw
    );


-- ============================================================
-- 3. 실제 검증 가격 -> 지역 평균가격 재계산 함수
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_regional_menu_prices_from_restaurants()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN

    /*
     * 이전에 자동 생성한 점메추 자체 평균만 삭제합니다.
     *
     * 참가격 등 외부/공공 평균 데이터는 그대로 보존합니다.
     */
    DELETE FROM regional_menu_prices

    WHERE
        source =
        'jummechu_verified_price_average';


    /*
     * 검증된 현재 가격 중
     * 동일 음식점 + 동일 주소 + 동일 메뉴가 중복되어 있다면
     * 가장 최신 행 하나만 표본으로 사용합니다.
     */
    WITH latest_prices AS (

        SELECT DISTINCT ON (
            LOWER(
                BTRIM(
                    restaurant_name
                )
            ),

            LOWER(
                BTRIM(
                    COALESCE(
                        restaurant_address,
                        ''
                    )
                )
            ),

            LOWER(
                BTRIM(
                    menu_name
                )
            )
        )

            restaurant_name,
            restaurant_address,
            BTRIM(menu_name)
                AS menu_name,
            price_krw,
            confidence,
            updated_at,
            id

        FROM restaurant_menu_prices

        WHERE
            price_krw > 0

            AND restaurant_address
                IS NOT NULL

            AND BTRIM(
                restaurant_address
            ) <> ''

            AND BTRIM(
                menu_name
            ) <> ''

        ORDER BY
            LOWER(
                BTRIM(
                    restaurant_name
                )
            ),

            LOWER(
                BTRIM(
                    COALESCE(
                        restaurant_address,
                        ''
                    )
                )
            ),

            LOWER(
                BTRIM(
                    menu_name
                )
            ),

            updated_at DESC,

            confidence DESC,

            id DESC
    ),


    /*
     * 한국 도로명 주소의 앞 두 토큰을 이용합니다.
     *
     * 예:
     * 대전광역시 서구 둔산로 ...
     * -> region1 = 대전광역시
     * -> region2 = 서구
     *
     * 경기도 수원시 ...
     * -> region1 = 경기도
     * -> region2 = 수원시
     */
    parsed_prices AS (

        SELECT
            menu_name,
            price_krw,

            REGEXP_SPLIT_TO_ARRAY(
                BTRIM(
                    restaurant_address
                ),
                E'\\s+'
            ) AS address_parts

        FROM latest_prices
    ),


    valid_prices AS (

        SELECT
            address_parts[1]
                AS region1,

            address_parts[2]
                AS region2,

            menu_name,
            price_krw

        FROM parsed_prices

        WHERE
            ARRAY_LENGTH(
                address_parts,
                1
            ) >= 2

            AND address_parts[1]
                ~ '(특별시|광역시|특별자치시|특별자치도|도)$'

            AND address_parts[2]
                ~ '(시|군|구)$'
    ),


    /*
     * 시/군/구 단위 평균
     */
    region2_averages AS (

        SELECT
            region1,
            region2,
            menu_name,

            round_price_up_500(
                AVG(
                    price_krw
                )
            )
                AS average_price_krw,

            COUNT(*)::INTEGER
                AS sample_count

        FROM valid_prices

        GROUP BY
            region1,
            region2,
            menu_name

        HAVING
            COUNT(*) >= 3
    ),


    /*
     * 광역시/특별시/도 단위 평균
     *
     * 같은 메뉴가 해당 광역 지역 전체에서
     * 3개 이상 모이면 구 단위 데이터가 없어도 fallback 가능.
     */
    region1_averages AS (

        SELECT
            region1,
            NULL::VARCHAR(50)
                AS region2,
            menu_name,

            round_price_up_500(
                AVG(
                    price_krw
                )
            )
                AS average_price_krw,

            COUNT(*)::INTEGER
                AS sample_count

        FROM valid_prices

        GROUP BY
            region1,
            menu_name

        HAVING
            COUNT(*) >= 3
    ),


    combined_averages AS (

        SELECT
            region1,
            region2,
            menu_name,
            average_price_krw,
            sample_count

        FROM region2_averages

        UNION ALL

        SELECT
            region1,
            region2,
            menu_name,
            average_price_krw,
            sample_count

        FROM region1_averages
    )


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
        region1,
        region2,
        menu_name,
        average_price_krw,
        sample_count,

        'jummechu_verified_price_average',

        CURRENT_DATE,

        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP

    FROM combined_averages;


END;
$$;


COMMENT ON FUNCTION refresh_regional_menu_prices_from_restaurants() IS
'Rebuilds Jummechu regional menu averages from verified restaurant_menu_prices. Minimum sample count: 3. Average is rounded upward to 500 KRW.';


-- ============================================================
-- 4. 자동 갱신 Trigger
-- ============================================================
--
-- restaurant_menu_prices 가 INSERT / UPDATE / DELETE 될 때마다
-- 점메추 자체 지역 평균을 재계산합니다.
--
-- FOR EACH STATEMENT:
-- 한 SQL 문에서 여러 행이 바뀌어도 한 번만 실행됩니다.
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_refresh_regional_menu_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    PERFORM
        refresh_regional_menu_prices_from_restaurants();

    RETURN NULL;

END;
$$;


DROP TRIGGER IF EXISTS
    trg_refresh_regional_menu_prices
ON
    restaurant_menu_prices;


CREATE TRIGGER trg_refresh_regional_menu_prices

AFTER INSERT OR UPDATE OR DELETE

ON restaurant_menu_prices

FOR EACH STATEMENT

EXECUTE FUNCTION
    trigger_refresh_regional_menu_prices();


-- ============================================================
-- 5. 현재 데이터로 최초 1회 계산
-- ============================================================

SELECT
    refresh_regional_menu_prices_from_restaurants();


COMMIT;


-- ============================================================
-- 6. 확인용 조회
-- ============================================================
--
-- 공공 평균 + 점메추 자체 평균을 함께 보여줍니다.
-- ============================================================

SELECT
    region1,
    region2,
    menu_name,
    average_price_krw,
    sample_count,
    source,
    reference_date

FROM regional_menu_prices

ORDER BY
    region1,
    region2 NULLS LAST,
    menu_name,
    reference_date DESC NULLS LAST;
