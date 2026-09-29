import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type AdminUserRow = {
  id: bigint;
  role: string;
};


type PriceReportRow = {
  id: bigint;
  user_id: bigint;

  user_email: string | null;
  user_name: string | null;

  restaurant_menu_price_id:
    bigint | null;

  restaurant_name: string;
  restaurant_address:
    string | null;

  menu_name: string;

  reported_price_krw: number;
  previous_price_krw:
    number | null;

  note:
    string | null;

  status: string;
  confidence: number;

  reviewed_at:
    Date | null;

  review_note:
    string | null;

  created_at: Date;
  updated_at: Date;

  evidence_count: bigint;
};


type LockedPriceReportRow = {
  id: bigint;
  user_id: bigint;

  restaurant_menu_price_id:
    bigint | null;

  restaurant_name: string;
  restaurant_address:
    string | null;

  menu_name: string;

  reported_price_krw: number;

  status: string;
};


type ExistingPriceRow = {
  id: bigint;
  price_krw: number;
};


function serializeReport(
  row: PriceReportRow
) {
  return {
    id:
      row.id.toString(),

    userId:
      row.user_id.toString(),

    userEmail:
      row.user_email,

    userName:
      row.user_name,

    restaurantMenuPriceId:
      row.restaurant_menu_price_id
        ?.toString() ??
      null,

    restaurantName:
      row.restaurant_name,

    restaurantAddress:
      row.restaurant_address,

    menuName:
      row.menu_name,

    reportedPriceKrw:
      row.reported_price_krw,

    previousPriceKrw:
      row.previous_price_krw,

    note:
      row.note,

    status:
      row.status,

    confidence:
      Number(
        row.confidence
      ),

    reviewedAt:
      row.reviewed_at,

    reviewNote:
      row.review_note,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,

    evidenceCount:
      Number(
        row.evidence_count
      ),
  };
}


async function requireAdmin() {
  const userId =
    await getUserId();

  if (!userId) {
    return {
      ok: false as const,

      response:
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
      AdminUserRow[]
    >`
      SELECT
        id,
        role

      FROM users

      WHERE
        id = ${userId}

      LIMIT 1
    `;


  const user =
    rows[0];


  if (
    !user ||
    user.role !==
      "admin"
  ) {
    return {
      ok: false as const,

      response:
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
    ok: true as const,
    userId,
  };
}


/* =========================================================
   GET
   관리자 가격 제보 목록
========================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }


    const requestedStatus =
      request.nextUrl
        .searchParams
        .get(
          "status"
        )
        ?.trim();


    const status =
      requestedStatus ===
        "approved" ||
      requestedStatus ===
        "rejected"
        ? requestedStatus
        : "pending";


    const rows =
      await prisma.$queryRaw<
        PriceReportRow[]
      >`
        SELECT
          pr.id,
          pr.user_id,

          u.email
            AS user_email,

          u.name
            AS user_name,

          pr.restaurant_menu_price_id,

          pr.restaurant_name,
          pr.restaurant_address,

          pr.menu_name,

          pr.reported_price_krw,
          pr.previous_price_krw,

          pr.note,

          pr.status,
          pr.confidence,

          pr.reviewed_at,
          pr.review_note,

          pr.created_at,
          pr.updated_at,

          COUNT(
            pre.id
          )::bigint
            AS evidence_count

        FROM price_reports pr

        JOIN users u
          ON u.id =
             pr.user_id

        LEFT JOIN
          price_report_evidence pre

          ON pre.report_id =
             pr.id

        WHERE
          pr.status =
          ${status}

        GROUP BY
          pr.id,
          u.id

        ORDER BY
          CASE
            WHEN pr.status =
              'pending'
            THEN 0
            ELSE 1
          END,

          pr.created_at
            DESC

        LIMIT 200
      `;


    return NextResponse.json({
      status,

      reports:
        rows.map(
          serializeReport
        ),
    });


  } catch (error) {
    console.error(
      "Admin price reports GET error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "가격 제보 목록을 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}


/* =========================================================
   PATCH
   관리자 승인 / 반려
========================================================= */

export async function PATCH(
  request: NextRequest
) {
  try {
    const admin =
      await requireAdmin();

    if (!admin.ok) {
      return admin.response;
    }


    const body =
      (await request.json()) as {
        reportId?: unknown;

        action?: unknown;

        reviewNote?: unknown;
      };


    const reportIdText =
      String(
        body.reportId ??
          ""
      ).trim();


    if (
      !/^\d+$/.test(
        reportIdText
      )
    ) {
      return NextResponse.json(
        {
          message:
            "가격 제보 ID가 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }


    const reportId =
      BigInt(
        reportIdText
      );


    const action =
      String(
        body.action ??
          ""
      ).trim();


    if (
      action !==
        "approve" &&
      action !==
        "reject"
    ) {
      return NextResponse.json(
        {
          message:
            "처리 방식이 올바르지 않습니다.",
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


    const result =
      await prisma.$transaction(
        async (tx) => {
          const reports =
            await tx.$queryRaw<
              LockedPriceReportRow[]
            >`
              SELECT
                id,
                user_id,

                restaurant_menu_price_id,

                restaurant_name,
                restaurant_address,

                menu_name,

                reported_price_krw,

                status

              FROM price_reports

              WHERE
                id =
                ${reportId}

              FOR UPDATE
            `;


          const report =
            reports[0];


          if (!report) {
            throw new Error(
              "PRICE_REPORT_NOT_FOUND"
            );
          }


          if (
            report.status !==
            "pending"
          ) {
            throw new Error(
              "PRICE_REPORT_ALREADY_REVIEWED"
            );
          }


          /* -------------------------------------------------
             반려
          ------------------------------------------------- */

          if (
            action ===
            "reject"
          ) {
            await tx.$executeRaw`
              UPDATE price_reports

              SET
                status =
                  'rejected',

                confidence =
                  0.0,

                reviewed_by =
                  ${admin.userId},

                reviewed_at =
                  CURRENT_TIMESTAMP,

                review_note =
                  ${
                    reviewNote ||
                    null
                  },

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE
                id =
                  ${reportId}
            `;


            await tx.$executeRaw`
              UPDATE user_price_reputation

              SET
                rejected_reports =
                  rejected_reports +
                  1,

                trust_score =
                  GREATEST(
                    trust_score -
                    1,
                    0
                  ),

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE
                user_id =
                  ${report.user_id}
            `;


            return {
              action:
                "rejected" as const,

              menuPriceId:
                null,
            };
          }


          /* -------------------------------------------------
             승인
             1) 연결된 기존 가격 ID 우선
             2) 없으면 가게명 + 주소 + 메뉴로 기존 가격 탐색
             3) 있으면 UPDATE
             4) 없으면 INSERT
             5) history 기록

             restaurant_menu_prices 변경 시
             DB trigger가 regional_menu_prices를 자동 갱신합니다.
          ------------------------------------------------- */

          let existing:
            ExistingPriceRow |
            undefined;


          if (
            report
              .restaurant_menu_price_id
          ) {
            const rows =
              await tx.$queryRaw<
                ExistingPriceRow[]
              >`
                SELECT
                  id,
                  price_krw

                FROM restaurant_menu_prices

                WHERE
                  id =
                  ${
                    report
                      .restaurant_menu_price_id
                  }

                LIMIT 1
              `;

            existing =
              rows[0];
          }


          if (!existing) {
            const rows =
              await tx.$queryRaw<
                ExistingPriceRow[]
              >`
                SELECT
                  id,
                  price_krw

                FROM restaurant_menu_prices

                WHERE
                  LOWER(
                    BTRIM(
                      restaurant_name
                    )
                  )
                  =
                  LOWER(
                    BTRIM(
                      ${
                        report
                          .restaurant_name
                      }
                    )
                  )

                  AND LOWER(
                    BTRIM(
                      menu_name
                    )
                  )
                  =
                  LOWER(
                    BTRIM(
                      ${
                        report
                          .menu_name
                      }
                    )
                  )

                  AND LOWER(
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
                      COALESCE(
                        ${
                          report
                            .restaurant_address
                        },
                        ''
                      )
                    )
                  )

                ORDER BY
                  confidence DESC,
                  updated_at DESC,
                  id DESC

                LIMIT 1
              `;

            existing =
              rows[0];
          }


          let menuPriceId:
            bigint;


          if (existing) {
            menuPriceId =
              existing.id;


            await tx.$executeRaw`
              UPDATE restaurant_menu_prices

              SET
                price_krw =
                  ${
                    report
                      .reported_price_krw
                  },

                source =
                  'user_report_approved',

                confidence =
                  1.0,

                observed_at =
                  CURRENT_TIMESTAMP,

                updated_at =
                  CURRENT_TIMESTAMP

              WHERE
                id =
                  ${menuPriceId}
            `;


            if (
              existing.price_krw !==
              report.reported_price_krw
            ) {
              await tx.$executeRaw`
                INSERT INTO
                  restaurant_menu_price_history
                (
                  restaurant_menu_price_id,

                  old_price_krw,
                  new_price_krw,

                  source,
                  report_id,
                  changed_by,

                  changed_at
                )

                VALUES
                (
                  ${menuPriceId},

                  ${
                    existing
                      .price_krw
                  },

                  ${
                    report
                      .reported_price_krw
                  },

                  'user_report_approved',

                  ${reportId},
                  ${admin.userId},

                  CURRENT_TIMESTAMP
                )
              `;
            }


          } else {
            const inserted =
              await tx.$queryRaw<
                Array<{
                  id: bigint;
                }>
              >`
                INSERT INTO
                  restaurant_menu_prices
                (
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
                  ${
                    report
                      .restaurant_name
                  },

                  ${
                    report
                      .restaurant_address
                  },

                  ${
                    report
                      .menu_name
                  },

                  ${
                    report
                      .reported_price_krw
                  },

                  'user_report_approved',

                  1.0,

                  CURRENT_TIMESTAMP,

                  CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP
                )

                RETURNING
                  id
              `;


            menuPriceId =
              inserted[0].id;


            await tx.$executeRaw`
              INSERT INTO
                restaurant_menu_price_history
              (
                restaurant_menu_price_id,

                old_price_krw,
                new_price_krw,

                source,
                report_id,
                changed_by,

                changed_at
              )

              VALUES
              (
                ${menuPriceId},

                NULL,

                ${
                  report
                    .reported_price_krw
                },

                'user_report_approved',

                ${reportId},
                ${admin.userId},

                CURRENT_TIMESTAMP
              )
            `;
          }


          await tx.$executeRaw`
            UPDATE price_reports

            SET
              restaurant_menu_price_id =
                ${menuPriceId},

              status =
                'approved',

              confidence =
                1.0,

              reviewed_by =
                ${admin.userId},

              reviewed_at =
                CURRENT_TIMESTAMP,

              review_note =
                ${
                  reviewNote ||
                  null
                },

              updated_at =
                CURRENT_TIMESTAMP

            WHERE
              id =
                ${reportId}
          `;


          await tx.$executeRaw`
            UPDATE user_price_reputation

            SET
              approved_reports =
                approved_reports +
                1,

              trust_score =
                trust_score +
                1,

              updated_at =
                CURRENT_TIMESTAMP

            WHERE
              user_id =
                ${report.user_id}
          `;


          return {
            action:
              "approved" as const,

            menuPriceId:
              menuPriceId
                .toString(),
          };
        },
        {
          timeout:
            20_000,
        }
      );


    return NextResponse.json({
      message:
        result.action ===
          "approved"
          ? "가격 제보를 승인했습니다. 실제 가격과 지역 평균에 반영됩니다."
          : "가격 제보를 반려했습니다.",

      result,
    });


  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(
            error
          );


    if (
      message ===
      "PRICE_REPORT_NOT_FOUND"
    ) {
      return NextResponse.json(
        {
          message:
            "가격 제보를 찾지 못했습니다.",
        },
        {
          status: 404,
        }
      );
    }


    if (
      message ===
      "PRICE_REPORT_ALREADY_REVIEWED"
    ) {
      return NextResponse.json(
        {
          message:
            "이미 처리된 가격 제보입니다.",
        },
        {
          status: 409,
        }
      );
    }


    console.error(
      "Admin price report PATCH error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "가격 제보 처리 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
