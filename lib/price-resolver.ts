import {
  prisma,
} from "@/lib/prisma";


export type RestaurantPriceSource =
  | "direct"
  | "regional"
  | "unknown";


export type RestaurantPriceFields = {
  /*
   * 가격 판단에 사용한 메뉴
   */
  priceMenuName:
    string | null;

  /*
   * 화면에 표시할 가격
   *
   * direct:
   *   실제 검증된 가게 메뉴 가격
   *
   * regional:
   *   해당 가게 직접 가격이 없을 때
   *   지역 평균 가격
   */
  priceKrw:
    number | null;

  /*
   * 검증된 실제 가게 가격
   */
  directPriceKrw:
    number | null;

  /*
   * 같은 메뉴의 지역 평균 가격
   */
  regionalAveragePriceKrw:
    number | null;

  /*
   * 기존 가격 데이터 ID.
   * 추후 가격 수정 제보 시 연결할 수 있습니다.
   */
  restaurantMenuPriceId:
    string | null;

  priceSource:
    RestaurantPriceSource;

  priceSourceLabel:
    string;

  /*
   * 0 ~ 100
   *
   * 직접 가격 + 지역 평균이 둘 다 있을 때만
   * 실제 상대 가격을 계산합니다.
   *
   * 비교 자료가 없으면 중립값 50.
   */
  priceScore:
    number;

  /*
   * 메뉴취향 60% + 가격 40%
   */
  valueScore:
    number;

  /*
   * 직접 가격이 지역 평균보다 몇 % 차이나는지.
   *
   * 음수:
   *   지역 평균보다 저렴
   *
   * 양수:
   *   지역 평균보다 비쌈
   */
  priceComparedToRegionalPercent:
    number | null;

  /*
   * 실제 가게 가격과 지역 평균을
   * 비교할 수 있는 상태인지.
   */
  priceComparable:
    boolean;
};


type PriceResolvableRestaurant = {
  id: string;

  name: string;

  address: string;

  roadAddress: string;

  matchedPreferences:
    string[];

  /*
   * 이 음식점과 가장 강하게 연결된 AI 추천 메뉴.
   *
   * 가격도 반드시 이 메뉴 기준으로 조회합니다.
   */
  recommendedMenuName:
    string | null;

  recommendedMenuScore:
    number | null;

  preferenceScore:
    number;

  distanceScore:
    number;

  recommendScore:
    number;
};


type DirectPriceRow = {
  id: bigint;

  restaurant_name:
    string;

  restaurant_address:
    string | null;

  menu_name:
    string;

  price_krw:
    number;

  source:
    string;

  confidence:
    number;

  updated_at:
    Date | string;
};


type RegionalPriceRow = {
  menu_name:
    string;

  average_price_krw:
    number;

  region1:
    string;

  region2:
    string | null;

  sample_count:
    number | null;

  source:
    string;

  reference_date:
    Date | string | null;

  updated_at:
    Date | string;
};


const NEUTRAL_PRICE_SCORE =
  50;


function clamp(
  value: number,
  min: number,
  max: number
) {

  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}


function normalizeText(
  value:
    string | null | undefined
) {

  return (
    value ??
    ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .toLowerCase();
}


function uniqueNonEmpty(
  values: string[]
) {

  return Array.from(
    new Set(
      values
        .map(
          (value) =>
            value.trim()
        )
        .filter(
          Boolean
        )
    )
  );
}


function addressesMatch(
  rowAddress:
    string | null,

  restaurant:
    PriceResolvableRestaurant
) {

  /*
   * 과거 데이터 중 주소가 비어 있는 가격은
   * 음식점명 기준으로만 매칭할 수 있도록 허용합니다.
   *
   * 새 가격 제보는 roadAddress/address를 함께 저장하는 것을 권장합니다.
   */
  if (
    !rowAddress
  ) {

    return true;
  }


  const normalizedRowAddress =
    normalizeText(
      rowAddress
    );


  if (
    !normalizedRowAddress
  ) {

    return true;
  }


  return (
    normalizedRowAddress ===
      normalizeText(
        restaurant.roadAddress
      ) ||
    normalizedRowAddress ===
      normalizeText(
        restaurant.address
      )
  );
}


function calculatePriceScore(
  directPrice:
    number | null,

  regionalAverage:
    number | null
) {

  if (
    !directPrice ||
    !regionalAverage ||
    directPrice <= 0 ||
    regionalAverage <= 0
  ) {

    return {
      score:
        NEUTRAL_PRICE_SCORE,

      comparable:
        false,

      differencePercent:
        null as number | null,
    };
  }


  const ratio =
    directPrice /
    regionalAverage;


  /*
   * v1 가격 점수
   *
   * 지역 평균의:
   *  80% 가격 -> 약 90점
   * 100% 가격 -> 60점
   * 120% 가격 -> 30점
   * 140% 이상 -> 0점
   *
   * 지나치게 싼 데이터 하나가
   * 추천 전체를 지배하지 않도록 100점에서 제한합니다.
   */
  const score =
    clamp(
      Math.round(
        60 +
        (
          1 -
          ratio
        ) *
        150
      ),
      0,
      100
    );


  const differencePercent =
    Math.round(
      (
        ratio -
        1
      ) *
      100
    );


  return {
    score,
    comparable:
      true,

    differencePercent,
  };
}


function makeUnknownPriceFields(
  restaurant:
    PriceResolvableRestaurant
):
  RestaurantPriceFields {

  return {
    priceMenuName:
      null,

    priceKrw:
      null,

    directPriceKrw:
      null,

    regionalAveragePriceKrw:
      null,

    restaurantMenuPriceId:
      null,

    priceSource:
      "unknown",

    priceSourceLabel:
      "가격 정보 없음",

    priceScore:
      NEUTRAL_PRICE_SCORE,

    valueScore:
      clamp(
        Math.round(
          restaurant
            .preferenceScore *
            0.60

          +

          NEUTRAL_PRICE_SCORE *
            0.40
        ),
        0,
        100
      ),

    priceComparedToRegionalPercent:
      null,

    priceComparable:
      false,
  };
}


export async function attachRestaurantPrices<
  T extends PriceResolvableRestaurant
>(
  restaurants: T[],

  region1: string,

  region2: string
):
  Promise<
    Array<
      T &
      RestaurantPriceFields
    >
  > {

  if (
    restaurants.length ===
    0
  ) {

    return [];
  }


  const restaurantNames =
    uniqueNonEmpty(
      restaurants.map(
        (restaurant) =>
          restaurant.name
      )
    );


  const menuNames =
    uniqueNonEmpty(
      restaurants.flatMap(
        (restaurant) => [
          ...(
            restaurant
              .recommendedMenuName
              ? [
                  restaurant
                    .recommendedMenuName,
                ]
              : []
          ),

          ...restaurant
            .matchedPreferences,
        ]
      )
    );


  if (
    restaurantNames.length ===
      0 ||
    menuNames.length ===
      0
  ) {

    return restaurants.map(
      (restaurant) => ({
        ...restaurant,

        ...makeUnknownPriceFields(
          restaurant
        ),
      })
    );
  }


  let directRows:
    DirectPriceRow[] = [];

  let regionalRows:
    RegionalPriceRow[] = [];


  try {

    const restaurantNamesJson =
      JSON.stringify(
        restaurantNames
      );


    directRows =
      await prisma.$queryRaw<
        DirectPriceRow[]
      >`
        SELECT
          rmp.id,

          rmp.restaurant_name,

          rmp.restaurant_address,

          rmp.menu_name,

          rmp.price_krw,

          rmp.source,

          rmp.confidence,

          rmp.updated_at

        FROM
          restaurant_menu_prices rmp

        JOIN
          jsonb_array_elements_text(
            ${restaurantNamesJson}::jsonb
          )
            AS names(
              restaurant_name
            )

          ON LOWER(
               BTRIM(
                 rmp.restaurant_name
               )
             )
             =
             LOWER(
               BTRIM(
                 names.restaurant_name
               )
             )

        WHERE
          rmp.price_krw >
          0

        ORDER BY
          rmp.confidence DESC,
          rmp.updated_at DESC,
          rmp.id DESC
      `;


    const menuNamesJson =
      JSON.stringify(
        menuNames
      );


    if (
      region1.trim()
    ) {

      regionalRows =
        await prisma.$queryRaw<
          RegionalPriceRow[]
        >`
          SELECT
            rmp.menu_name,

            rmp.average_price_krw,

            rmp.region1,

            rmp.region2,

            rmp.sample_count,

            rmp.source,

            rmp.reference_date,

            rmp.updated_at

          FROM
            regional_menu_prices rmp

          JOIN
            jsonb_array_elements_text(
              ${menuNamesJson}::jsonb
            )
              AS menus(
                menu_name
              )

            ON LOWER(
                 BTRIM(
                   rmp.menu_name
                 )
               )
               =
               LOWER(
                 BTRIM(
                   menus.menu_name
                 )
               )

          WHERE
            LOWER(
              BTRIM(
                rmp.region1
              )
            )
            =
            LOWER(
              BTRIM(
                ${region1}
              )
            )

            AND (
              rmp.region2
                IS NULL

              OR

              LOWER(
                BTRIM(
                  rmp.region2
                )
              )
              =
              LOWER(
                BTRIM(
                  ${region2}
                )
              )
            )

          ORDER BY
            CASE
              WHEN
                rmp.region2
                  IS NOT NULL

                AND

                LOWER(
                  BTRIM(
                    rmp.region2
                  )
                )
                =
                LOWER(
                  BTRIM(
                    ${region2}
                  )
                )

              THEN 0

              ELSE 1
            END,

            rmp.reference_date
              DESC NULLS LAST,

            rmp.updated_at DESC,

            rmp.id DESC
        `;
    }


  } catch (error) {

    /*
     * 가격 테이블이 아직 없거나
     * 가격 조회에 실패해도
     * 음식점 추천 전체는 계속 동작해야 합니다.
     */
    console.error(
      "Restaurant price lookup error:",
      error
    );


    return restaurants.map(
      (restaurant) => ({
        ...restaurant,

        ...makeUnknownPriceFields(
          restaurant
        ),
      })
    );
  }


  return restaurants.map(
    (restaurant) => {

      /*
       * 가격은 "추천 메뉴" 하나를 기준으로만 잡습니다.
       *
       * 예:
       *   추천 메뉴 = 돈가스
       *   → 돈가스 직접 가격
       *   → 없으면 돈가스 지역 평균
       *
       * 다른 매칭 메뉴의 가격을 대신 가져오지 않습니다.
       * 그래야 사용자가 보는 추천 메뉴와 가격의 의미가 일치합니다.
       */
      const selectedMenu =
        restaurant
          .recommendedMenuName
          ?.trim() ||
        null;


      let selectedDirect:
        DirectPriceRow | null =
          null;

      let selectedRegional:
        RegionalPriceRow | null =
          null;


      if (
        selectedMenu
      ) {

        const normalizedMenu =
          normalizeText(
            selectedMenu
          );


        selectedDirect =
          directRows.find(
            (row) =>
              normalizeText(
                row.restaurant_name
              ) ===
                normalizeText(
                  restaurant.name
                )

              &&

              normalizeText(
                row.menu_name
              ) ===
                normalizedMenu

              &&

              addressesMatch(
                row.restaurant_address,
                restaurant
              )
          ) ??
          null;


        selectedRegional =
          regionalRows.find(
            (row) =>
              normalizeText(
                row.menu_name
              ) ===
              normalizedMenu
          ) ??
          null;
      }


      const priceResult =
        calculatePriceScore(
          selectedDirect
            ?.price_krw ??
            null,

          selectedRegional
            ?.average_price_krw ??
            null
        );


      const priceScore =
        priceResult.score;


      const valueScore =
        clamp(
          Math.round(

            restaurant
              .preferenceScore *
              0.60

            +

            priceScore *
              0.40
          ),
          0,
          100
        );


      /*
       * 추천 탭:
       *
       * 신뢰할 수 있는 직접 가격 + 지역 평균 비교가 가능할 때만
       * 가격 30%를 최종 추천에 넣습니다.
       *
       * 가격 비교자료가 부족하면 기존 추천식
       * 메뉴 70% + 거리 30%를 그대로 유지합니다.
       */
      const recommendScore =
        priceResult.comparable

          ? clamp(
              Math.round(

                restaurant
                  .preferenceScore *
                  0.50

                +

                priceScore *
                  0.30

                +

                restaurant
                  .distanceScore *
                  0.20
              ),
              0,
              100
            )

          : restaurant
              .recommendScore;


      let priceSource:
        RestaurantPriceSource =
          "unknown";

      let priceSourceLabel =
        "가격 정보 없음";

      let priceKrw:
        number | null =
          null;


      if (
        selectedDirect
      ) {

        priceSource =
          "direct";

        priceSourceLabel =
          "확인된 가격";

        priceKrw =
          selectedDirect
            .price_krw;

      } else if (
        selectedRegional
      ) {

        priceSource =
          "regional";

        priceSourceLabel =
          "지역 평균 기준";

        priceKrw =
          selectedRegional
            .average_price_krw;
      }


      return {
        ...restaurant,

        recommendScore,

        priceMenuName:
          selectedMenu,

        priceKrw,

        directPriceKrw:
          selectedDirect
            ?.price_krw ??
            null,

        regionalAveragePriceKrw:
          selectedRegional
            ?.average_price_krw ??
            null,

        restaurantMenuPriceId:
          selectedDirect
            ? selectedDirect
                .id
                .toString()
            : null,

        priceSource,

        priceSourceLabel,

        priceScore,

        valueScore,

        priceComparedToRegionalPercent:
          priceResult
            .differencePercent,

        priceComparable:
          priceResult
            .comparable,
      };
    }
  );
}
