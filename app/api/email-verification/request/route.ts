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
  generateVerificationCode,
  hashVerificationCode,
  isValidEmail,
  isVerificationPurpose,
  normalizeEmail,
  VERIFICATION_RESEND_MS,
} from "@/lib/email-verification";

import {
  sendVerificationCodeEmail,
} from "@/lib/mailer";


type LatestCodeRow = {
  id: bigint;
  retry_after_seconds: number;
};


type UserExistsRow = {
  id: bigint;
};


export async function POST(
  request: NextRequest
) {
  try {
    const globalLimit =
      rateLimit(
        "email-verification-request-global",
        30,
        60_000
      );

    if (globalLimit) {
      return globalLimit;
    }

    const body =
      await request
        .json()
        .catch(() => null);

    const email =
      normalizeEmail(
        body?.email
      );

    const purpose =
      body?.purpose;

    if (
      !isValidEmail(
        email
      ) ||
      !isVerificationPurpose(
        purpose
      )
    ) {
      return NextResponse.json(
        {
          message:
            "이메일 또는 인증 목적이 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const emailLimit =
      rateLimit(
        "email-verification-request-email",
        5,
        10 * 60_000,
        `${purpose}:${email}`
      );

    if (emailLimit) {
      return emailLimit;
    }

    const users =
      await prisma.$queryRaw<
        UserExistsRow[]
      >`
        SELECT id
        FROM users
        WHERE email = ${email}
        LIMIT 1
      `;

    const exists =
      users.length > 0;

    if (
      purpose ===
        "signup" &&
      exists
    ) {
      return NextResponse.json(
        {
          message:
            "이미 가입된 이메일입니다.",
        },
        {
          status: 409,
        }
      );
    }

    /*
     * 비밀번호 재설정은 계정 존재 여부를 외부에 노출하지 않습니다.
     */
    if (
      purpose ===
        "password_reset" &&
      !exists
    ) {
      return NextResponse.json({
        success: true,
        message:
          "가입된 이메일이라면 인증번호를 발송했습니다.",
        resendAfterSeconds: 60,
      });
    }

    /*
     * 재전송 제한 계산은 애플리케이션 Date가 아니라
     * PostgreSQL NOW() 기준으로 계산합니다.
     *
     * Windows / PostgreSQL / Node 사이의 timezone 해석 차이 때문에
     * 60초가 약 9시간(32,000초)으로 계산되는 문제를 방지합니다.
     */
    const latestRows =
      await prisma.$queryRaw<
        LatestCodeRow[]
      >`
        SELECT
          id,

          GREATEST(
            0,
            CEIL(
              ${VERIFICATION_RESEND_MS / 1000} -
              EXTRACT(
                EPOCH FROM (
                  NOW() -
                  created_at
                )
              )
            )
          )::int
            AS retry_after_seconds

        FROM email_verification_codes

        WHERE
          email = ${email}
          AND purpose = ${purpose}
          AND consumed_at IS NULL

        ORDER BY id DESC

        LIMIT 1
      `;

    const latest =
      latestRows[0];

    const retryAfter =
      latest
        ? Number(
            latest.retry_after_seconds
          )
        : 0;

    if (
      Number.isFinite(
        retryAfter
      ) &&
      retryAfter > 0
    ) {
      return NextResponse.json(
        {
          message:
            `${retryAfter}초 후 다시 요청해주세요.`,

          resendAfterSeconds:
            retryAfter,
        },
        {
          status: 429,

          headers: {
            "Retry-After":
              String(
                retryAfter
              ),
          },
        }
      );
    }

    const code =
      generateVerificationCode();

    const codeHash =
      hashVerificationCode(
        email,
        purpose,
        code
      );

    /*
     * expires_at도 PostgreSQL의 NOW() 기준으로 생성합니다.
     *
     * Windows / Node / PostgreSQL 사이의 timezone 해석 차이로
     * "방금 인증했는데 만료됨"이 발생하지 않도록
     * 만료 생성과 만료 판정을 모두 DB 시간으로 통일합니다.
     */

    /*
     * 이전 미사용 코드는 폐기하고 새 코드만 유효하게 합니다.
     */
    const insertedRows =
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            UPDATE email_verification_codes
            SET
              consumed_at = COALESCE(
                consumed_at,
                NOW()
              ),
              updated_at = NOW()
            WHERE
              email = ${email}
              AND purpose = ${purpose}
              AND consumed_at IS NULL
          `;

          return await tx.$queryRaw<
            { id: bigint }[]
          >`
            INSERT INTO email_verification_codes (
              email,
              purpose,
              code_hash,
              expires_at,
              created_at,
              updated_at
            )
            VALUES (
              ${email},
              ${purpose},
              ${codeHash},

              NOW() +
                INTERVAL '10 minutes',

              NOW(),
              NOW()
            )
            RETURNING id
          `;
        }
      );

    const verificationId =
      insertedRows[0]?.id;

    try {
      await sendVerificationCodeEmail({
        to:
          email,

        code,

        purpose,
      });
    } catch (mailError) {
      if (verificationId) {
        await prisma.$executeRaw`
          UPDATE email_verification_codes
          SET
            consumed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${verificationId}
        `;
      }

      console.error(
        "EMAIL VERIFICATION MAIL ERROR:",
        mailError
      );

      return NextResponse.json(
        {
          message:
            "인증 메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "인증번호를 이메일로 발송했습니다.",
      expiresInSeconds:
        600,
      resendAfterSeconds:
        60,
    });

  } catch (error) {
    console.error(
      "EMAIL VERIFICATION REQUEST ERROR:",
      error
    );

    return NextResponse.json(
      {
        message:
          "인증번호 요청 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
