import {
  prisma,
} from "@/lib/prisma";


export type RestaurantPriceSource =
  | "direct"
  | "regional"
  | "unknown";


export type RestaurantPriceFields = {
  /*
   * 가격 판단에 사용한 추천 메뉴
   */
  priceMenuName:
    string | null;

  /*
   * 화면 표시 및 예산 필터에 사용할 가격.
   *
   * direct:
   *   해당 가게의 확인된 실제 추천 메뉴 가격
   *
   * regional:
   *   직접 가격이 없을 때 같은 메뉴의 지역 평균 가격
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
   * 기존 실제 가격 데이터 ID
   */
  restaurantMenuPriceId:
    string | null;

  priceSource:
    RestaurantPriceSource;

  priceSourceLabel:
    string;
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


function makeUnknownPriceFields():
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

        ...makeUnknownPriceFields(),
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

        ...makeUnknownPriceFields(),
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

      };
    }
  );
}
