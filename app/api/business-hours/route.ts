import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

type BusinessHoursBody = {
  restaurantKey?: unknown;
  restaurantName?: unknown;
  roadAddress?: unknown;
  dayOfWeek?: unknown;
  openTime?: unknown;
  closeTime?: unknown;
  breakStartTime?: unknown;
  breakEndTime?: unknown;
  isClosed?: unknown;
  applyAllDays?: unknown;
  sourceUrl?: unknown;
};

function normalizeText(
  value: unknown,
  maxLength: number
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function normalizeTime(
  value: unknown
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
    ? text
    : null;
}

function normalizeNaverUrl(
  value: unknown
) {
  const text =
    normalizeText(
      value,
      1000
    );

  if (!text) {
    return null;
  }

  try {
    const url =
      new URL(text);

    const host =
      url.hostname.toLowerCase();

    if (
      host === "naver.com" ||
      host.endsWith(".naver.com") ||
      host === "naver.me" ||
      host.endsWith(".naver.me")
    ) {
      return text;
    }
  } catch {
    // ignore invalid URL
  }

  return null;
}

export async function POST(
  request: NextRequest
) {
  try {
    const userId =
      await getUserId();

    if (!userId) {
      return NextResponse.json(
        {
          message:
            "로그인이 필요합니다.",
        },
        {
          status: 401,
        }
      );
    }

    const limited =
      rateLimit(
        "business-hours-post-user",
        20,
        60_000,
        userId.toString()
      );

    if (limited) {
      return limited;
    }

    let body:
      BusinessHoursBody;

    try {
      body =
        (
          await request.json()
        ) as BusinessHoursBody;
    } catch {
      return NextResponse.json(
        {
          message:
            "올바른 JSON 형식이 아닙니다.",
        },
        {
          status: 400,
        }
      );
    }

    const restaurantKey =
      normalizeText(
        body.restaurantKey,
        1000
      );

    const restaurantName =
      normalizeText(
        body.restaurantName,
        200
      );

    const roadAddress =
      normalizeText(
        body.roadAddress,
        500
      );

    if (
      !restaurantKey ||
      !restaurantName ||
      !roadAddress
    ) {
      return NextResponse.json(
        {
          message:
            "음식점 정보가 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const expectedKey =
      `${restaurantName}|${roadAddress}`;

    if (
      restaurantKey !==
      expectedKey
    ) {
      return NextResponse.json(
        {
          message:
            "음식점 식별 정보가 일치하지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const dayOfWeek =
      Number(
        body.dayOfWeek
      );

    if (
      !Number.isInteger(
        dayOfWeek
      ) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6
    ) {
      return NextResponse.json(
        {
          message:
            "요일 정보가 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const isClosed =
      body.isClosed === true;

    const applyAllDays =
      body.applyAllDays === true;

    const openTime =
      normalizeTime(
        body.openTime
      );

    const closeTime =
      normalizeTime(
        body.closeTime
      );

    const breakStartTime =
      normalizeTime(
        body.breakStartTime
      );

    const breakEndTime =
      normalizeTime(
        body.breakEndTime
      );

    if (
      !isClosed &&
      (
        !openTime ||
        !closeTime
      )
    ) {
      return NextResponse.json(
        {
          message:
            "영업 시작/종료 시간을 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      Boolean(
        breakStartTime
      ) !==
      Boolean(
        breakEndTime
      )
    ) {
      return NextResponse.json(
        {
          message:
            "브레이크타임 시작/종료 시간을 모두 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const sourceUrl =
      normalizeNaverUrl(
        body.sourceUrl
      );

    const days =
      applyAllDays
        ? [0, 1, 2, 3, 4, 5, 6]
        : [dayOfWeek];


    type UserRoleRow = {
      role: string;
    };


    const roleRows =
      await prisma.$queryRaw<
        UserRoleRow[]
      >`
        SELECT role
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `;


    const isAdmin =
      roleRows[0]?.role ===
      "admin";


    /*
     * 관리자:
     * 검토 과정 없이 공식 영업시간에 즉시 반영.
     */
    if (isAdmin) {

      await prisma.$transaction(
        async (tx) => {

          for (
            const day
            of days
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
                ${day},

                ${
                  isClosed
                    ? null
                    : openTime
                }::time,

                ${
                  isClosed
                    ? null
                    : closeTime
                }::time,

                ${
                  isClosed
                    ? null
                    : breakStartTime
                }::time,

                ${
                  isClosed
                    ? null
                    : breakEndTime
                }::time,

                ${isClosed},

                'admin_direct',

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
          }
        },
        {
          timeout:
            15_000,
        }
      );


      return NextResponse.json({
        success:
          true,

        applied:
          true,

        role:
          "admin",

        message:
          applyAllDays
            ? "관리자 권한으로 모든 요일에 즉시 반영했습니다."
            : "관리자 권한으로 영업시간을 즉시 반영했습니다.",

        days,
      });
    }


    /*
     * 일반 사용자:
     * 공식 영업시간을 직접 수정하지 않고 pending 제보만 생성.
     *
     * 같은 사용자가 같은 가게/요일에 다시 제보하면
     * 기존 pending 제보 내용을 갱신합니다.
     */
    await prisma.$transaction(
      async (tx) => {

        for (
          const day
          of days
        ) {

          await tx.$executeRaw`
            INSERT INTO
              business_hours_reports (
                user_id,

                restaurant_key,
                restaurant_name,
                road_address,

                day_of_week,

                open_time,
                close_time,

                break_start_time,
                break_end_time,

                is_closed,

                source_url,

                status,

                created_at,
                updated_at
              )

            VALUES (
              ${userId},

              ${restaurantKey},
              ${restaurantName},
              ${roadAddress},

              ${day},

              ${
                isClosed
                  ? null
                  : openTime
              }::time,

              ${
                isClosed
                  ? null
                  : closeTime
              }::time,

              ${
                isClosed
                  ? null
                  : breakStartTime
              }::time,

              ${
                isClosed
                  ? null
                  : breakEndTime
              }::time,

              ${isClosed},

              ${sourceUrl},

              'pending',

              NOW(),
              NOW()
            )

            ON CONFLICT (
              user_id,
              restaurant_key,
              day_of_week
            )

            WHERE status =
              'pending'

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

              source_url =
                EXCLUDED.source_url,

              updated_at =
                NOW()
          `;
        }
      },
      {
        timeout:
          15_000,
      }
    );


    return NextResponse.json(
      {
        success:
          true,

        applied:
          false,

        role:
          "user",

        status:
          "pending",

        message:
          applyAllDays
            ? "영업시간 제보가 접수되었습니다. 관리자 승인 후 모든 요일에 반영됩니다."
            : "영업시간 제보가 접수되었습니다. 관리자 승인 후 반영됩니다.",

        days,
      },
      {
        status: 202,
      }
    );

  } catch (error) {
    console.error(
      "Business hours POST error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "영업시간 제보 처리 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
