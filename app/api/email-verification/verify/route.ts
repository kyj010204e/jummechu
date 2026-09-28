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
  generateVerificationToken,
  hashVerificationCode,
  hashVerificationToken,
  isValidEmail,
  isVerificationPurpose,
  normalizeEmail,
  safeHashEquals,
  VERIFICATION_MAX_ATTEMPTS,
} from "@/lib/email-verification";


type VerificationRow = {
  id: bigint;

  code_hash: string;

  attempt_count: number;

  consumed_at:
    Date | null;
};


export async function POST(
  request: NextRequest
) {
  try {
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

    const code =
      typeof body?.code ===
        "string"
        ? body.code.trim()
        : "";

    if (
      !isValidEmail(
        email
      ) ||
      !isVerificationPurpose(
        purpose
      ) ||
      !/^\d{6}$/.test(
        code
      )
    ) {
      return NextResponse.json(
        {
          message:
            "이메일 또는 인증번호를 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const limited =
      rateLimit(
        "email-verification-verify",
        10,
        10 * 60_000,
        `${purpose}:${email}`
      );

    if (limited) {
      return limited;
    }

    const rows =
      await prisma.$queryRaw<
        VerificationRow[]
      >`
        SELECT
          id,
          code_hash,
          attempt_count,
          consumed_at

        FROM email_verification_codes

        WHERE
          email = ${email}
          AND purpose = ${purpose}
          AND consumed_at IS NULL
          AND expires_at > NOW()

        ORDER BY id DESC

        LIMIT 1
      `;

    const row =
      rows[0];

    if (
      !row ||
      row.consumed_at
    ) {
      return NextResponse.json(
        {
          message:
            "인증번호가 만료되었거나 유효하지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      row.attempt_count >=
      VERIFICATION_MAX_ATTEMPTS
    ) {
      return NextResponse.json(
        {
          message:
            "인증 시도 횟수를 초과했습니다. 인증번호를 다시 요청해주세요.",
        },
        {
          status: 429,
        }
      );
    }

    const actualHash =
      hashVerificationCode(
        email,
        purpose,
        code
      );

    const matches =
      safeHashEquals(
        row.code_hash,
        actualHash
      );

    if (!matches) {
      const nextAttempts =
        row.attempt_count + 1;

      await prisma.$executeRaw`
        UPDATE email_verification_codes
        SET
          attempt_count =
            ${nextAttempts},

          consumed_at =
            CASE
              WHEN ${nextAttempts} >=
                   ${VERIFICATION_MAX_ATTEMPTS}
              THEN NOW()
              ELSE consumed_at
            END,

          updated_at =
            NOW()
        WHERE id = ${row.id}
      `;

      return NextResponse.json(
        {
          message:
            nextAttempts >=
            VERIFICATION_MAX_ATTEMPTS
              ? "인증 시도 횟수를 초과했습니다. 인증번호를 다시 요청해주세요."
              : `인증번호가 올바르지 않습니다. ${VERIFICATION_MAX_ATTEMPTS - nextAttempts}회 남았습니다.`,
        },
        {
          status: 400,
        }
      );
    }

    const verificationToken =
      generateVerificationToken();

    const tokenHash =
      hashVerificationToken(
        email,
        purpose,
        verificationToken
      );

    await prisma.$executeRaw`
      UPDATE email_verification_codes
      SET
        verified_at =
          NOW(),

        verification_token_hash =
          ${tokenHash},

        updated_at =
          NOW()
      WHERE id = ${row.id}
    `;

    /*
     * 인증 레코드 ID + 랜덤 토큰을 묶어서 클라이언트에 전달합니다.
     *
     * 가입/비밀번호 변경 단계에서는 먼저 정확한 레코드 ID로 조회한 뒤
     * 저장된 HMAC hash와 토큰을 timing-safe 방식으로 비교합니다.
     * 이렇게 하면 토큰 hash를 SQL 문자열 비교에 직접 의존하지 않습니다.
     */
    const verificationHandle =
      `${row.id.toString()}.${verificationToken}`;


    return NextResponse.json({
      success:
        true,

      message:
        "이메일 인증이 완료되었습니다.",

      verificationToken:
        verificationHandle,
    });

  } catch (error) {
    console.error(
      "EMAIL VERIFICATION VERIFY ERROR:",
      error
    );

    return NextResponse.json(
      {
        message:
          "이메일 인증 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
