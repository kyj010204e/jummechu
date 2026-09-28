import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  getUserId,
} from "@/lib/session";

import {
  rateLimit,
} from "@/lib/rate-limit";


type RoleRow = {
  role: string;
};


type PendingReportRow = {
  id: bigint;

  user_id: bigint;

  reporter_email:
    string;

  reporter_name:
    string;

  restaurant_key:
    string;

  restaurant_name:
    string;

  road_address:
    string;

  day_of_week:
    number;

  open_time:
    string | null;

  close_time:
    string | null;

  break_start_time:
    string | null;

  break_end_time:
    string | null;

  is_closed:
    boolean;

  source_url:
    string | null;

  status:
    string;

  created_at:
    Date | string;
};


type ReviewBody = {
  /*
   * 새 구조:
   * 한 번의 "매일 동일 시간" 제보는 최대 7개의 DB row이므로
   * reportIds를 한 번에 승인/거절합니다.
   */
  reportIds?: unknown;

  /*
   * 구버전 클라이언트 호환용.
   */
  reportId?: unknown;

  action?: unknown;

  reviewNote?: unknown;
};


type LockedReportRow = {
  id: bigint;

  restaurant_key:
    string;

  restaurant_name:
    string;

  road_address:
    string;

  day_of_week:
    number;

  open_time:
    string | null;

  close_time:
    string | null;

  break_start_time:
    string | null;

  break_end_time:
    string | null;

  is_closed:
    boolean;

  source_url:
    string | null;

  status:
    string;
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


function toCreatedAtKey(
  value:
    Date | string
) {

  return new Date(
    value
  ).toISOString();
}


/*
 * 같은 사용자 요청에서 생성된 요일별 row를
 * 관리자 화면에서는 하나의 "제보 묶음"으로 보여줍니다.
 *
 * business-hours POST는 한 transaction 안에서
 * 각 요일 row에 NOW()를 사용하므로,
 * 한 번의 요청으로 생성된 row들은 created_at이 같습니다.
 *
 * 따라서 별도 DB migration 없이 현재 데이터도 바로 묶을 수 있습니다.
 */
function groupPendingReports(
  rows:
    PendingReportRow[]
) {

  type Group = {
    reportIds:
      string[];

    userId:
      string;

    reporterEmail:
      string;

    reporterName:
      string;

    restaurantKey:
      string;

    restaurantName:
      string;

    roadAddress:
      string;

    dayOfWeeks:
      number[];

    openTime:
      string | null;

    closeTime:
      string | null;

    breakStartTime:
      string | null;

    breakEndTime:
      string | null;

    isClosed:
      boolean;

    sourceUrl:
      string | null;

    status:
      string;

    createdAt:
      string;
  };


  const groups =
    new Map<
      string,
      Group
    >();


  for (
    const row
    of rows
  ) {

    const createdAt =
      toCreatedAtKey(
        row.created_at
      );


    const groupKey =
      [
        row.user_id.toString(),
        row.restaurant_key,
        createdAt,
      ].join(
        "::"
      );


    const existing =
      groups.get(
        groupKey
      );


    if (existing) {

      existing.reportIds.push(
        row.id.toString()
      );


      if (
        !existing.dayOfWeeks.includes(
          Number(
            row.day_of_week
          )
        )
      ) {

        existing.dayOfWeeks.push(
          Number(
            row.day_of_week
          )
        );
      }


      continue;
    }


    groups.set(
      groupKey,
      {
        reportIds: [
          row.id.toString(),
        ],

        userId:
          row.user_id.toString(),

        reporterEmail:
          row.reporter_email,

        reporterName:
          row.reporter_name,

        restaurantKey:
          row.restaurant_key,

        restaurantName:
          row.restaurant_name,

        roadAddress:
          row.road_address,

        dayOfWeeks: [
          Number(
            row.day_of_week
          ),
        ],

        openTime:
          row.open_time,

        closeTime:
          row.close_time,

        breakStartTime:
          row.break_start_time,

        breakEndTime:
          row.break_end_time,

        isClosed:
          row.is_closed,

        sourceUrl:
          row.source_url,

        status:
          row.status,

        createdAt,
      }
    );
  }


  return Array.from(
    groups.values()
  )
    .map(
      (group) => ({
        ...group,

        reportIds:
          group.reportIds.sort(
            (
              a,
              b
            ) =>
              Number(
                BigInt(a) -
                BigInt(b)
              )
          ),

        dayOfWeeks:
          group.dayOfWeeks.sort(
            (
              a,
              b
            ) =>
              a - b
          ),
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        new Date(
          a.createdAt
        ).getTime() -
        new Date(
          b.createdAt
        ).getTime()
    );
}


/* =========================================================
   GET
   pending 영업시간 제보
========================================================= */

export async function GET() {

  try {

    const admin =
      await getAdminUserId();


    if (admin.error) {
      return admin.error;
    }


    const limited =
      rateLimit(
        "admin-business-hours-get",
        60,
        60_000,
        admin.userId!.toString()
      );


    if (limited) {
      return limited;
    }


    const rows =
      await prisma.$queryRaw<
        PendingReportRow[]
      >`
        SELECT
          bhr.id,

          bhr.user_id,

          COALESCE(
            u.email,
            ''
          )
            AS reporter_email,

          COALESCE(
            u.name,
            ''
          )
            AS reporter_name,

          bhr.restaurant_key,

          bhr.restaurant_name,

          bhr.road_address,

          bhr.day_of_week,

          CASE
            WHEN bhr.open_time
              IS NULL
            THEN NULL
            ELSE to_char(
              bhr.open_time,
              'HH24:MI'
            )
          END
            AS open_time,

          CASE
            WHEN bhr.close_time
              IS NULL
            THEN NULL
            ELSE to_char(
              bhr.close_time,
              'HH24:MI'
            )
          END
            AS close_time,

          CASE
            WHEN bhr.break_start_time
              IS NULL
            THEN NULL
            ELSE to_char(
              bhr.break_start_time,
              'HH24:MI'
            )
          END
            AS break_start_time,

          CASE
            WHEN bhr.break_end_time
              IS NULL
            THEN NULL
            ELSE to_char(
              bhr.break_end_time,
              'HH24:MI'
            )
          END
            AS break_end_time,

          bhr.is_closed,

          bhr.source_url,

          bhr.status,

          bhr.created_at

        FROM
          business_hours_reports bhr

        JOIN users u
          ON u.id =
             bhr.user_id

        WHERE
          bhr.status =
          'pending'

        ORDER BY
          bhr.created_at ASC,
          bhr.day_of_week ASC

        LIMIT 700
      `;


    const groupedReports =
      groupPendingReports(
        rows
      );


    return NextResponse.json({
      reports:
        groupedReports,

      /*
       * 관리자 UI의 "몇 건"은 이제 DB row 수가 아니라
       * 실제 사용자 제출 횟수 기준입니다.
       */
      count:
        groupedReports.length,

      pendingRows:
        rows.length,
    });


  } catch (error) {

    console.error(
      "Admin business hours GET error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "영업시간 제보를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}


/* =========================================================
   PATCH
   일괄 승인 / 일괄 거절
========================================================= */

export async function PATCH(
  request: NextRequest
) {

  try {

    const admin =
      await getAdminUserId();


    if (admin.error) {
      return admin.error;
    }


    const limited =
      rateLimit(
        "admin-business-hours-patch",
        60,
        60_000,
        admin.userId!.toString()
      );


    if (limited) {
      return limited;
    }


    let body:
      ReviewBody;


    try {

      body =
        (
          await request.json()
        ) as ReviewBody;

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


    const rawReportIds =
      Array.isArray(
        body.reportIds
      )
        ? body.reportIds
        : body.reportId !==
            undefined
          ? [
              body.reportId,
            ]
          : [];


    const reportIdTexts =
      Array.from(
        new Set(
          rawReportIds.map(
            (value) =>
              String(
                value
              )
          )
        )
      );


    if (
      reportIdTexts.length ===
        0 ||
      reportIdTexts.length >
        7 ||
      reportIdTexts.some(
        (value) =>
          !/^\d+$/.test(
            value
          )
      )
    ) {

      return NextResponse.json(
        {
          message:
            "제보 ID 목록이 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }


    const action =
      body.action ===
        "approve" ||
      body.action ===
        "reject"
        ? body.action
        : null;


    if (!action) {

      return NextResponse.json(
        {
          message:
            "승인 또는 거절 작업이 필요합니다.",
        },
        {
          status: 400,
        }
      );
    }


    const reviewNote =
      typeof body.reviewNote ===
        "string"

        ? body.reviewNote
            .trim()
            .slice(
              0,
              1000
            )

        : "";


    const idsJson =
      JSON.stringify(
        reportIdTexts
      );


    const result =
      await prisma.$transaction(
        async (tx) => {

          /*
           * 먼저 묶음 전체를 잠그고 검증합니다.
           * 하나라도 이미 처리되었거나 없으면 아무 것도 반영하지 않습니다.
           */
          const rows =
            await tx.$queryRaw<
              LockedReportRow[]
            >`
              SELECT
                bhr.id,

                bhr.restaurant_key,

                bhr.restaurant_name,

                bhr.road_address,

                bhr.day_of_week,

                CASE
                  WHEN bhr.open_time
                    IS NULL
                  THEN NULL
                  ELSE to_char(
                    bhr.open_time,
                    'HH24:MI'
                  )
                END
                  AS open_time,

                CASE
                  WHEN bhr.close_time
                    IS NULL
                  THEN NULL
                  ELSE to_char(
                    bhr.close_time,
                    'HH24:MI'
                  )
                END
                  AS close_time,

                CASE
                  WHEN bhr.break_start_time
                    IS NULL
                  THEN NULL
                  ELSE to_char(
                    bhr.break_start_time,
                    'HH24:MI'
                  )
                END
                  AS break_start_time,

                CASE
                  WHEN bhr.break_end_time
                    IS NULL
                  THEN NULL
                  ELSE to_char(
                    bhr.break_end_time,
                    'HH24:MI'
                  )
                END
                  AS break_end_time,

                bhr.is_closed,

                bhr.source_url,

                bhr.status

              FROM
                business_hours_reports bhr

              JOIN
                jsonb_array_elements_text(
                  ${idsJson}::jsonb
                )
                  AS requested_ids(
                    id_text
                  )

                ON bhr.id =
                   requested_ids.id_text::bigint

              ORDER BY
                bhr.day_of_week ASC

              FOR UPDATE OF bhr
            `;


          if (
            rows.length !==
            reportIdTexts.length
          ) {

            return {
              status:
                "not_found",
              count:
                0,
            };
          }


          if (
            rows.some(
              (row) =>
                row.status !==
                "pending"
            )
          ) {

            return {
              status:
                "already_reviewed",
              count:
                0,
            };
          }


          if (
            action ===
            "approve"
          ) {

            for (
              const report
              of rows
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
                  ${report.restaurant_key},

                  ${report.restaurant_name},

                  ${report.road_address},

                  ${report.day_of_week},

                  ${
                    report.is_closed
                      ? null
                      : report.open_time
                  }::time,

                  ${
                    report.is_closed
                      ? null
                      : report.close_time
                  }::time,

                  ${
                    report.is_closed
                      ? null
                      : report.break_start_time
                  }::time,

                  ${
                    report.is_closed
                      ? null
                      : report.break_end_time
                  }::time,

                  ${report.is_closed},

                  'user_report_approved',

                  ${report.source_url},

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
          }


          await tx.$executeRaw`
            UPDATE
              business_hours_reports bhr

            SET
              status =
                ${
                  action ===
                  "approve"
                    ? "approved"
                    : "rejected"
                },

              reviewed_by =
                ${admin.userId},

              reviewed_at =
                NOW(),

              review_note =
                ${
                  reviewNote ||
                  null
                },

              updated_at =
                NOW()

            WHERE
              bhr.id IN (
                SELECT
                  value::bigint

                FROM
                  jsonb_array_elements_text(
                    ${idsJson}::jsonb
                  )
              )
          `;


          return {
            status:
              action ===
              "approve"
                ? "approved"
                : "rejected",

            count:
              rows.length,
          };
        },
        {
          timeout:
            15_000,
        }
      );


    if (
      result.status ===
      "not_found"
    ) {

      return NextResponse.json(
        {
          message:
            "제보 중 일부를 찾을 수 없습니다.",
        },
        {
          status: 404,
        }
      );
    }


    if (
      result.status ===
      "already_reviewed"
    ) {

      return NextResponse.json(
        {
          message:
            "묶음 안에 이미 처리된 제보가 있습니다. 새로고침 후 다시 확인해주세요.",
        },
        {
          status: 409,
        }
      );
    }


    return NextResponse.json({
      success:
        true,

      status:
        result.status,

      processedCount:
        result.count,

      message:
        result.status ===
          "approved"
          ? `${result.count}개 요일을 한 번에 승인하고 영업시간에 반영했습니다.`
          : `${result.count}개 요일 제보를 한 번에 거절했습니다.`,
    });


  } catch (error) {

    console.error(
      "Admin business hours PATCH error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "제보 처리 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
