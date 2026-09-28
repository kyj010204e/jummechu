import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  rateLimit,
} from "@/lib/rate-limit";

import {
  getUserId,
} from "@/lib/session";

import {
  parseNaverPlaceText,
} from "@/lib/naver-place-text-parser";


type RoleRow = {
  role: string;
};


type ImportBody = {
  action?:
    | "parse"
    | "import";

  restaurantName?:
    string;

  roadAddress?:
    string;

  sourceUrl?:
    string | null;

  rawText?:
    string;
};


type ExistingPriceRow = {
  id: bigint;

  price_krw: number;
};


async function getAdminUserId() {

  const userId =
    await getUserId();


  if (!userId) {

    return {
      userId:
        null,

      error:
        NextResponse.json(
          {
            message:
              "로그인이 필요합니다.",
          },
          {
            status: 401,
          }
        ),
    };
  }


  const rows =
    await prisma.$queryRaw<
      RoleRow[]
    >`
      SELECT role
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;


  if (
    rows[0]?.role !==
    "admin"
  ) {

    return {
      userId:
        null,

      error:
        NextResponse.json(
          {
            message:
              "관리자 권한이 필요합니다.",
          },
          {
            status: 403,
          }
        ),
    };
  }


  return {
    userId,
    error:
      null,
  };
}


function normalizeText(
  value:
    unknown
) {

  return typeof value ===
    "string"
    ? value
        .trim()
        .replace(
          /\s+/g,
          " "
        )
    : "";
}


export async function GET() {

  const admin =
    await getAdminUserId();


  if (
    admin.error
  ) {
    return admin.error;
  }


  return NextResponse.json({
    success:
      true,

    admin:
      true,
  });
}


export async function POST(
  request: NextRequest
) {

  try {

    const admin =
      await getAdminUserId();


    if (
      admin.error
    ) {
      return admin.error;
    }


    const limited =
      rateLimit(
        "admin-place-import",
        30,
        60_000,
        admin.userId!.toString()
      );


    if (
      limited
    ) {
      return limited;
    }


    const body =
      (
        await request.json()
      ) as ImportBody;


    const action =
      body.action ===
        "import"
        ? "import"
        : "parse";


    const rawText =
      typeof body.rawText ===
        "string"
        ? body.rawText
        : "";


    if (
      rawText.trim().length <
      10
    ) {

      return NextResponse.json(
        {
          message:
            "네이버 플레이스에서 복사한 텍스트를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      rawText.length >
      200_000
    ) {

      return NextResponse.json(
        {
          message:
            "복사한 텍스트가 너무 깁니다.",
        },
        {
          status: 400,
        }
      );
    }


    const parsed =
      parseNaverPlaceText(
        rawText
      );


    if (
      action ===
      "parse"
    ) {

      return NextResponse.json({
        success:
          true,

        parsed,
      });
    }


    const restaurantName =
      normalizeText(
        body.restaurantName
      );


    const roadAddress =
      normalizeText(
        body.roadAddress
      );


    const sourceUrl =
      normalizeText(
        body.sourceUrl
      ) ||
      null;


    if (
      !restaurantName
    ) {

      return NextResponse.json(
        {
          message:
            "음식점 이름을 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      !roadAddress
    ) {

      return NextResponse.json(
        {
          message:
            "음식점 도로명 주소를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      parsed.businessHours
          .length ===
        0 &&
      parsed.menus.length ===
        0
    ) {

      return NextResponse.json(
        {
          message:
            "반영할 영업시간 또는 메뉴 가격을 찾지 못했습니다.",
        },
        {
          status: 400,
        }
      );
    }


    const restaurantKey =
      `${restaurantName}|${roadAddress}`;


    const result =
      await prisma.$transaction(
        async (
          tx
        ) => {

          let hoursCount =
            0;


          let insertedPriceCount =
            0;


          let updatedPriceCount =
            0;


          for (
            const hours
            of parsed.businessHours
          ) {

            await tx.$executeRaw`
              INSERT INTO
                restaurant_business_hours (
                  restaurant_key,

                  restaurant_name,

                  road_address,

                  day_of_week,

                  open_time,

                  close_time,

                  break_start_time,

                  break_end_time,

                  is_closed,

                  source,

                  source_url,

                  verified_at,

                  updated_at
                )

              VALUES (
                ${restaurantKey},

                ${restaurantName},

                ${roadAddress},

                ${hours.dayOfWeek},

                ${
                  hours.isClosed
                    ? null
                    : hours.openTime
                }::time,

                ${
                  hours.isClosed
                    ? null
                    : hours.closeTime
                }::time,

                ${
                  hours.isClosed
                    ? null
                    : hours.breakStartTime
                }::time,

                ${
                  hours.isClosed
                    ? null
                    : hours.breakEndTime
                }::time,

                ${hours.isClosed},

                'naver_place_text_import',

                ${sourceUrl},

                NOW(),

                NOW()
              )

              ON CONFLICT (
                restaurant_key,
                day_of_week
              )

              DO UPDATE SET
                restaurant_name =
                  EXCLUDED.restaurant_name,

                road_address =
                  EXCLUDED.road_address,

                open_time =
                  EXCLUDED.open_time,

                close_time =
                  EXCLUDED.close_time,

                break_start_time =
                  EXCLUDED.break_start_time,

                break_end_time =
                  EXCLUDED.break_end_time,

                is_closed =
                  EXCLUDED.is_closed,

                source =
                  EXCLUDED.source,

                source_url =
                  EXCLUDED.source_url,

                verified_at =
                  EXCLUDED.verified_at,

                updated_at =
                  NOW()
            `;


            hoursCount +=
              1;
          }


          for (
            const menu
            of parsed.menus
          ) {

            const existingRows =
              await tx.$queryRaw<
                ExistingPriceRow[]
              >`
                SELECT
                  id,

                  price_krw

                FROM
                  restaurant_menu_prices

                WHERE
                  LOWER(
                    BTRIM(
                      restaurant_name
                    )
                  )
                  =
                  LOWER(
                    BTRIM(
                      ${restaurantName}
                    )
                  )

                  AND

                  LOWER(
                    BTRIM(
                      COALESCE(
                        restaurant_address,
                        ''
                      )
                    )
                  )
                  =
                  LOWER(
                    BTRIM(
                      ${roadAddress}
                    )
                  )

                  AND

                  LOWER(
                    BTRIM(
                      menu_name
                    )
                  )
                  =
                  LOWER(
                    BTRIM(
                      ${menu.name}
                    )
                  )

                ORDER BY
                  updated_at DESC,
                  id DESC

                LIMIT 1
              `;


            const existing =
              existingRows[0];


            if (
              existing
            ) {

              if (
                existing.price_krw !==
                menu.priceKrw
              ) {

                await tx.$executeRaw`
                  INSERT INTO
                    restaurant_menu_price_history (
                      restaurant_menu_price_id,

                      old_price_krw,

                      new_price_krw,

                      source,

                      report_id,

                      changed_by,

                      changed_at
                    )

                  VALUES (
                    ${existing.id},

                    ${existing.price_krw},

                    ${menu.priceKrw},

                    'naver_place_text_import',

                    NULL,

                    ${admin.userId},

                    NOW()
                  )
                `;
              }


              await tx.$executeRaw`
                UPDATE
                  restaurant_menu_prices

                SET
                  price_krw =
                    ${menu.priceKrw},

                  source =
                    'naver_place_text_import',

                  confidence =
                    0.95,

                  source_url =
                    ${sourceUrl},

                  observed_at =
                    NOW(),

                  updated_at =
                    NOW()

                WHERE
                  id =
                  ${existing.id}
              `;


              updatedPriceCount +=
                1;

              continue;
            }


            const createdRows =
              await tx.$queryRaw<
                Array<{
                  id: bigint;
                }>
              >`
                INSERT INTO
                  restaurant_menu_prices (
                    restaurant_name,

                    restaurant_address,

                    menu_name,

                    price_krw,

                    source,

                    confidence,

                    source_url,

                    observed_at,

                    created_at,

                    updated_at
                  )

                VALUES (
                  ${restaurantName},

                  ${roadAddress},

                  ${menu.name},

                  ${menu.priceKrw},

                  'naver_place_text_import',

                  0.95,

                  ${sourceUrl},

                  NOW(),

                  NOW(),

                  NOW()
                )

                RETURNING
                  id
              `;


            const created =
              createdRows[0];


            if (
              created
            ) {

              await tx.$executeRaw`
                INSERT INTO
                  restaurant_menu_price_history (
                    restaurant_menu_price_id,

                    old_price_krw,

                    new_price_krw,

                    source,

                    report_id,

                    changed_by,

                    changed_at
                  )

                VALUES (
                  ${created.id},

                  NULL,

                  ${menu.priceKrw},

                  'naver_place_text_import',

                  NULL,

                  ${admin.userId},

                  NOW()
                )
              `;
            }


            insertedPriceCount +=
              1;
          }


          return {
            hoursCount,

            insertedPriceCount,

            updatedPriceCount,
          };
        },
        {
          timeout:
            20_000,
        }
      );


    return NextResponse.json({
      success:
        true,

      restaurantKey,

      parsed,

      imported: {
        businessHours:
          result.hoursCount,

        insertedPrices:
          result.insertedPriceCount,

        updatedPrices:
          result.updatedPriceCount,
      },

      message:
        `영업시간 ${result.hoursCount}개, 새 가격 ${result.insertedPriceCount}개, 갱신 가격 ${result.updatedPriceCount}개를 반영했습니다.`,
    });


  } catch (error) {

    console.error(
      "ADMIN PLACE IMPORT ERROR:",
      error
    );


    return NextResponse.json(
      {
        message:
          "네이버 플레이스 정보 반영 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
