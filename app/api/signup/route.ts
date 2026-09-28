import {
  NextResponse,
} from "next/server";

import {
  cookies,
} from "next/headers";

import bcrypt from "bcryptjs";

import {
  prisma,
} from "@/lib/prisma";

import {
  rateLimit,
} from "@/lib/rate-limit";

import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";

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
  request: Request
) {
  try {
    const limited =
      rateLimit(
        "signup-global",
        60,
        60_000
      );

    if (limited) {
      return limited;
    }

    const body =
      await request
        .json()
        .catch(() => null);

    if (
      !body ||
      typeof body.email !==
        "string" ||
      typeof body.password !==
        "string" ||
      typeof body.verificationToken !==
        "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "회원가입 정보를 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const name =
      String(
        body.name ?? ""
      ).trim();

    const email =
      normalizeEmail(
        body.email
      );

    const password =
      body.password;

    const verificationToken =
      body.verificationToken.trim();

    if (
      !name ||
      name.length > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이름을 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !isValidEmail(
        email
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "올바른 이메일 주소를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      password.length < 8 ||
      password.length > 1024 ||
      Buffer.byteLength(
        password,
        "utf8"
      ) > 72
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "비밀번호는 8자 이상 입력해주세요.",
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
          success: false,
          message:
            "이메일 인증을 먼저 완료해주세요.",
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

    const accountLimit =
      rateLimit(
        "signup-email",
        10,
        15 * 60_000,
        email
      );

    if (accountLimit) {
      return accountLimit;
    }

    const existingUser =
      await prisma.users.findUnique({
        where: {
          email,
        },
      });

    if (existingUser) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이미 가입된 이메일입니다.",
        },
        {
          status: 409,
        }
      );
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
          AND purpose = 'signup'
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
        "signup",
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
          success: false,
          message:
            "이메일 인증이 만료되었거나 유효하지 않습니다. 다시 인증해주세요.",
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

    const user =
      await prisma.$transaction(
        async (tx) => {
          const created =
            await tx.users.create({
              data: {
                name,
                email,
                password_hash:
                  passwordHash,
              },
            });

          await tx.$executeRaw`
            UPDATE users
            SET email_verified_at =
              NOW()
            WHERE id = ${created.id}
          `;

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

          return created;
        }
      );

    const token =
      await createSessionToken(
        user.id.toString()
      );

    const cookieStore =
      await cookies();

    cookieStore.set(
      SESSION_COOKIE_NAME,
      token,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite:
          "lax",

        path:
          "/",

        maxAge:
          SESSION_DURATION,
      }
    );

    return NextResponse.json(
      {
        success: true,

        message:
          "회원가입이 완료되었습니다.",

        user: {
          id:
            user.id.toString(),

          name:
            user.name,

          email:
            user.email,
        },
      },
      {
        status: 201,
      }
    );

  } catch (error) {
    if (
      error &&
      typeof error ===
        "object" &&
      "code" in error &&
      error.code === "P2002"
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

    console.error(
      "SIGNUP ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "회원가입 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
