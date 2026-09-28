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
  isValidEmail,
  normalizeEmail,
} from "@/lib/email-verification";


type VerifiedRow = {
  email_verified_at:
    Date | null;
};


export async function POST(
  request: Request
) {
  try {
    const limited =
      rateLimit(
        "login-global",
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
        "string"
    ) {
      return NextResponse.json(
        {
          message:
            "이메일과 비밀번호를 확인해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const email =
      normalizeEmail(
        body.email
      );

    const password =
      body.password;

    if (
      !isValidEmail(
        email
      ) ||
      password.length >
        1024
    ) {
      return NextResponse.json(
        {
          message:
            "이메일 또는 비밀번호가 올바르지 않습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const accountLimit =
      rateLimit(
        "login-email",
        10,
        15 * 60_000,
        email
      );

    if (accountLimit) {
      return accountLimit;
    }

    const user =
      await prisma.users.findUnique({
        where: {
          email,
        },
      });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이메일 또는 비밀번호가 올바르지 않습니다.",
        },
        {
          status: 401,
        }
      );
    }

    const passwordMatches =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!passwordMatches) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이메일 또는 비밀번호가 올바르지 않습니다.",
        },
        {
          status: 401,
        }
      );
    }

    const verifiedRows =
      await prisma.$queryRaw<
        VerifiedRow[]
      >`
        SELECT email_verified_at
        FROM users
        WHERE id = ${user.id}
        LIMIT 1
      `;

    if (
      !verifiedRows[0]
        ?.email_verified_at
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이메일 인증이 필요한 계정입니다.",
        },
        {
          status: 403,
        }
      );
    }

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

    return NextResponse.json({
      success: true,

      message:
        "로그인되었습니다.",

      user: {
        id:
          user.id.toString(),

        name:
          user.name,

        email:
          user.email,
      },
    });

  } catch (error) {
    console.error(
      "LOGIN ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "로그인 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
