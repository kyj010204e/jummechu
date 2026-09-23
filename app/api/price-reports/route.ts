import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";
import {
  NextRequest,
  NextResponse,
} from "next/server";


/* =========================================================
   타입
========================================================= */

type PriceReportBody = {
  restaurantMenuPriceId?: string | number | null;

  restaurantName?: string;
  restaurantAddress?: string | null;

  menuName?: string;

  reportedPriceKrw?: number;
  previousPriceKrw?: number | null;

  note?: string | null;
};


type CreatedPriceReportRow = {
  id: bigint;
  user_id: bigint;

  restaurant_menu_price_id:
    bigint | null;

  restaurant_name: string;
  restaurant_address: string | null;

  menu_name: string;

  reported_price_krw: number;
  previous_price_krw: number | null;

  note: string | null;

  status: string;
  confidence: number;

  created_at: Date;
};


type MyPriceReportRow = {
  id: bigint;

  restaurant_name: string;
  restaurant_address: string | null;

  menu_name: string;

  reported_price_krw: number;
  previous_price_krw: number | null;

  note: string | null;

  status: string;
  confidence: number;

  reviewed_at: Date | null;
  review_note: string | null;

  created_at: Date;
  updated_at: Date;

  evidence_count: bigint;
};


/* =========================================================
   기본 설정
========================================================= */

/*
 * 가격 제보는 일반 조회 API보다 엄격하게 제한합니다.
 *
 * 1분에 5회면 정상적인 사용에는 충분하고,
 * 단순 도배는 어느 정도 막을 수 있습니다.
 *
 * 운영 단계에서는 Redis/DB 기반 rate limit으로
 * 교체하는 것을 권장합니다.
 */
const PRICE_REPORT_LIMIT = 5;
const PRICE_REPORT_WINDOW_MS =
  60_000;


/*
 * 입력 길이 제한
 */
const MAX_RESTAURANT_NAME_LENGTH =
  200;

const MAX_ADDRESS_LENGTH =
  500;

const MAX_MENU_NAME_LENGTH =
  200;

const MAX_NOTE_LENGTH =
  1000;


/*
 * 가격 유효 범위
 *
 * 100원 미만이나 1,000만원 초과 가격은
 * 음식 메뉴 가격 제보로 보기 어려우므로 차단합니다.
 */
const MIN_PRICE_KRW = 100;
const MAX_PRICE_KRW =
  10_000_000;


/* =========================================================
   유틸
========================================================= */

function normalizeText(
  value: string
) {

  return value
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}


function normalizeNullableText(
  value:
    | string
    | null
    | undefined
) {

  if (
    typeof value !==
    "string"
  ) {

    return null;
  }


  const normalized =
    normalizeText(
      value
    );


  return normalized ||
    null;
}


function isValidPrice(
  value: unknown
): value is number {

  return (
    typeof value ===
      "number" &&

    Number.isInteger(
      value
    ) &&

    value >=
      MIN_PRICE_KRW &&

    value <=
      MAX_PRICE_KRW
  );
}


function parseOptionalBigInt(
  value:
    | string
    | number
    | null
    | undefined
) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {

    return null;
  }


  const text =
    String(value);


  if (
    !/^\d+$/.test(
      text
    )
  ) {

    return null;
  }


  try {

    return BigInt(
      text
    );

  } catch {

    return null;
  }
}


function serializeReport(
  row:
    CreatedPriceReportRow |
    MyPriceReportRow
) {

  return {
    id:
      row.id.toString(),

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

    createdAt:
      row.created_at,

    ...(
      "updated_at" in row
        ? {
            updatedAt:
              row.updated_at,

            reviewedAt:
              row.reviewed_at,

            reviewNote:
              row.review_note,

            evidenceCount:
              Number(
                row.evidence_count
              ),
          }
        : {}
    ),
  };
}


function isUniqueViolation(
  error: unknown
) {

  const message =
    error instanceof Error
      ? error.message
      : String(error);


  return (
    message.includes(
      "23505"
    ) ||

    message.includes(
      "uniq_pending_price_report"
    ) ||

    message.includes(
      "Unique constraint"
    )
  );
}


/* =========================================================
   GET
   내가 제보한 가격 목록
========================================================= */

export async function GET() {

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
        "price-reports-get-user",
        30,
        60_000,
        userId.toString()
      );


    if (limited) {

      return limited;
    }


    const rows =
      await prisma.$queryRaw<
        MyPriceReportRow[]
      >`
        SELECT
          pr.id,

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

        LEFT JOIN
          price_report_evidence pre
          ON pre.report_id =
             pr.id

        WHERE
          pr.user_id =
          ${userId}

        GROUP BY
          pr.id

        ORDER BY
          pr.created_at DESC

        LIMIT 100
      `;


    return NextResponse.json({
      reports:
        rows.map(
          serializeReport
        ),
    });


  } catch (error) {

    console.error(
      "Price reports GET error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "가격 제보 내역을 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}


/* =========================================================
   POST
   가격 제보 생성
========================================================= */

export async function POST(
  request: NextRequest
) {

  try {

    /* -------------------------------------------------------
       1. 로그인
    ------------------------------------------------------- */

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


    /* -------------------------------------------------------
       2. Rate Limit
    ------------------------------------------------------- */

    const limited =
      rateLimit(
        "price-reports-post-user",
        PRICE_REPORT_LIMIT,
        PRICE_REPORT_WINDOW_MS,
        userId.toString()
      );


    if (limited) {

      return limited;
    }


    /* -------------------------------------------------------
       3. JSON
    ------------------------------------------------------- */

    let body:
      PriceReportBody;


    try {

      body =
        (
          await request.json()
        ) as PriceReportBody;

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


    /* -------------------------------------------------------
       4. 문자열 정리
    ------------------------------------------------------- */

    const restaurantName =
      typeof body.restaurantName ===
        "string"
        ? normalizeText(
            body.restaurantName
          )
        : "";


    const restaurantAddress =
      normalizeNullableText(
        body.restaurantAddress
      );


    const menuName =
      typeof body.menuName ===
        "string"
        ? normalizeText(
            body.menuName
          )
        : "";


    const note =
      normalizeNullableText(
        body.note
      );


    /* -------------------------------------------------------
       5. 입력 검증
    ------------------------------------------------------- */

    if (!restaurantName) {

      return NextResponse.json(
        {
          message:
            "음식점 이름이 필요합니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      restaurantName.length >
      MAX_RESTAURANT_NAME_LENGTH
    ) {

      return NextResponse.json(
        {
          message:
            "음식점 이름이 너무 깁니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      restaurantAddress &&
      restaurantAddress.length >
        MAX_ADDRESS_LENGTH
    ) {

      return NextResponse.json(
        {
          message:
            "음식점 주소가 너무 깁니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (!menuName) {

      return NextResponse.json(
        {
          message:
            "메뉴 이름이 필요합니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      menuName.length >
      MAX_MENU_NAME_LENGTH
    ) {

      return NextResponse.json(
        {
          message:
            "메뉴 이름이 너무 깁니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      !isValidPrice(
        body.reportedPriceKrw
      )
    ) {

      return NextResponse.json(
        {
          message:
            `제보 가격은 ${MIN_PRICE_KRW.toLocaleString("ko-KR")}원 이상 ${MAX_PRICE_KRW.toLocaleString("ko-KR")}원 이하의 정수여야 합니다.`,
        },
        {
          status: 400,
        }
      );
    }


    if (
      body.previousPriceKrw !==
        undefined &&
      body.previousPriceKrw !==
        null &&
      !isValidPrice(
        body.previousPriceKrw
      )
    ) {

      return NextResponse.json(
        {
          message:
            "기존 가격 형식이 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }


    if (
      note &&
      note.length >
        MAX_NOTE_LENGTH
    ) {

      return NextResponse.json(
        {
          message:
            `추가 설명은 ${MAX_NOTE_LENGTH}자 이내로 입력해주세요.`,
        },
        {
          status: 400,
        }
      );
    }


    const restaurantMenuPriceId =
      parseOptionalBigInt(
        body.restaurantMenuPriceId
      );


    if (
      body.restaurantMenuPriceId !==
        undefined &&
      body.restaurantMenuPriceId !==
        null &&
      restaurantMenuPriceId ===
        null
    ) {

      return NextResponse.json(
        {
          message:
            "가격 데이터 ID가 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }


    /* -------------------------------------------------------
       6. 같은 사용자의 중복 pending 확인

       DB의 partial unique index가 최종 방어선이지만,
       사용자에게 더 이해하기 쉬운 오류를 주기 위해
       먼저 확인합니다.
    ------------------------------------------------------- */

    const duplicateRows =
      await prisma.$queryRaw<
        Array<{
          id: bigint;
        }>
      >`
        SELECT
          id

        FROM price_reports

        WHERE
          user_id =
            ${userId}

          AND LOWER(
            restaurant_name
          ) =
            LOWER(
              ${restaurantName}
            )

          AND LOWER(
            menu_name
          ) =
            LOWER(
              ${menuName}
            )

          AND status =
            'pending'

        LIMIT 1
      `;


    if (
      duplicateRows.length > 0
    ) {

      return NextResponse.json(
        {
          message:
            "이미 검토 중인 동일 메뉴 가격 제보가 있습니다.",
          reportId:
            duplicateRows[0]
              .id
              .toString(),
        },
        {
          status: 409,
        }
      );
    }


    /* -------------------------------------------------------
       7. 기존 가격 ID 검증

       ID가 넘어온 경우 실제 테이블에 존재하는지만
       확인합니다. 존재하지 않으면 연결하지 않습니다.
    ------------------------------------------------------- */

    let verifiedMenuPriceId:
      bigint | null =
        null;


    if (
      restaurantMenuPriceId !==
        null
    ) {

      const existingPriceRows =
        await prisma.$queryRaw<
          Array<{
            id: bigint;
          }>
        >`
          SELECT
            id

          FROM restaurant_menu_prices

          WHERE
            id =
              ${restaurantMenuPriceId}

          LIMIT 1
        `;


      if (
        existingPriceRows.length ===
        0
      ) {

        return NextResponse.json(
          {
            message:
              "연결하려는 기존 가격 데이터를 찾지 못했습니다.",
          },
          {
            status: 404,
          }
        );
      }


      verifiedMenuPriceId =
        restaurantMenuPriceId;
    }


    /* -------------------------------------------------------
       8. 제보 생성 + 평판 통계 증가
    ------------------------------------------------------- */

    const created =
      await prisma.$transaction(
        async (tx) => {

          const reportRows =
            await tx.$queryRaw<
              CreatedPriceReportRow[]
            >`
              INSERT INTO
                price_reports
              (
                user_id,

                restaurant_menu_price_id,

                restaurant_name,
                restaurant_address,

                menu_name,

                reported_price_krw,
                previous_price_krw,

                note,

                status,
                confidence,

                created_at,
                updated_at
              )

              VALUES
              (
                ${userId},

                ${verifiedMenuPriceId},

                ${restaurantName},
                ${restaurantAddress},

                ${menuName},

                ${body.reportedPriceKrw},
                ${
                  body.previousPriceKrw ??
                  null
                },

                ${note},

                'pending',
                0.0,

                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
              )

              RETURNING
                id,
                user_id,

                restaurant_menu_price_id,

                restaurant_name,
                restaurant_address,

                menu_name,

                reported_price_krw,
                previous_price_krw,

                note,

                status,
                confidence,

                created_at
            `;


          await tx.$executeRaw`
            INSERT INTO
              user_price_reputation
            (
              user_id,

              trust_score,

              total_reports,
              approved_reports,
              rejected_reports,
              evidence_reports,

              updated_at
            )

            VALUES
            (
              ${userId},

              0,

              1,
              0,
              0,
              0,

              CURRENT_TIMESTAMP
            )

            ON CONFLICT
              (user_id)

            DO UPDATE SET

              total_reports =
                user_price_reputation
                  .total_reports + 1,

              updated_at =
                CURRENT_TIMESTAMP
          `;


          return reportRows[0];
        }
      );


    /* -------------------------------------------------------
       9. 응답
    ------------------------------------------------------- */

    return NextResponse.json(
      {
        message:
          "가격 제보가 접수되었습니다. 검토 후 반영됩니다.",

        report:
          serializeReport(
            created
          ),
      },
      {
        status: 201,
      }
    );


  } catch (error) {

    /*
     * 동시에 같은 제보가 들어와도
     * partial unique index가 마지막으로 차단합니다.
     */
    if (
      isUniqueViolation(
        error
      )
    ) {

      return NextResponse.json(
        {
          message:
            "이미 검토 중인 동일 메뉴 가격 제보가 있습니다.",
        },
        {
          status: 409,
        }
      );
    }


    console.error(
      "Price report POST error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "가격 제보를 저장하지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
