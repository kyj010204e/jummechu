import {
  NextRequest,
  NextResponse,
} from "next/server";

import bcrypt from "bcryptjs";

import {
  prisma,
} from "@/lib/prisma";

import {
  rateLimit,
} from "@/lib/rate-limit";

import {
  hashVerificationToken,
  isValidEmail,
  normalizeEmail,
  safeHashEquals,
} from "@/lib/email-verification";


type VerificationRow = {
  id: bigint;

  verification_token_hash:
    string | null;

  is_not_expired:
    boolean;
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

    const password =
      typeof body?.password ===
        "string"
        ? body.password
        : "";

    const verificationToken =
      typeof body?.verificationToken ===
        "string"
        ? body.verificationToken.trim()
        : "";

    if (
      !isValidEmail(
        email
      ) ||
      password.length < 8 ||
      password.length > 1024 ||
      Buffer.byteLength(
        password,
        "utf8"
      ) > 72
    ) {
      return NextResponse.json(
        {
          message:
            "비밀번호 재설정 정보를 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const tokenMatch =
      verificationToken.match(
        /^(\d+)\.([A-Za-z0-9_-]{20,})$/
      );


    if (!tokenMatch) {
      return NextResponse.json(
        {
          message:
            "이메일 인증을 다시 진행해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    const verificationId =
      BigInt(
        tokenMatch[1]
      );


    const rawVerificationToken =
      tokenMatch[2];


    const limited =
      rateLimit(
        "password-reset-confirm",
        10,
        15 * 60_000,
        email
      );

    if (limited) {
      return limited;
    }

    const verificationRows =
      await prisma.$queryRaw<
        VerificationRow[]
      >`
        SELECT
          id,

          verification_token_hash,

          (
            expires_at >
            NOW()
          ) AS is_not_expired

        FROM email_verification_codes

        WHERE
          id = ${verificationId}
          AND email = ${email}
          AND purpose =
            'password_reset'
          AND verified_at IS NOT NULL
          AND consumed_at IS NULL

        LIMIT 1
      `;


    const verification =
      verificationRows[0];


    const expectedTokenHash =
      verification
        ?.verification_token_hash;


    const actualTokenHash =
      hashVerificationToken(
        email,
        "password_reset",
        rawVerificationToken
      );


    const tokenIsValid =
      Boolean(
        verification &&
        verification.is_not_expired &&
        expectedTokenHash &&
        safeHashEquals(
          expectedTokenHash,
          actualTokenHash
        )
      );


    if (!tokenIsValid) {
      return NextResponse.json(
        {
          message:
            "인증이 만료되었거나 유효하지 않습니다. 다시 인증해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const user =
      await prisma.users.findUnique({
        where: {
          email,
        },
      });

    /*
     * request 단계에서 계정 존재 여부를 숨겼기 때문에
     * 여기까지 올 수 없는 정상 흐름이지만 동일한 메시지로 처리합니다.
     */
    if (!user) {
      return NextResponse.json(
        {
          message:
            "비밀번호 재설정 정보를 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    await prisma.$transaction(
      async (tx) => {
        await tx.users.update({
          where: {
            email,
          },

          data: {
            password_hash:
              passwordHash,
          },
        });

        await tx.$executeRaw`
          UPDATE email_verification_codes
          SET
            consumed_at =
              NOW(),
            updated_at =
              NOW()
          WHERE id =
            ${verification.id}
            AND consumed_at IS NULL
        `;
      }
    );

    return NextResponse.json({
      success: true,
      message:
        "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.",
    });

  } catch (error) {
    console.error(
      "PASSWORD RESET CONFIRM ERROR:",
      error
    );

    return NextResponse.json(
      {
        message:
          "비밀번호 변경 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
