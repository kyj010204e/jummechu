import { rateLimit } from "@/lib/rate-limit";
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
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";

export async function POST(
  request: Request
) {
  try {
    const limited = rateLimit("login-global", 60, 60_000);
    if (limited) return limited;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ message: "이메일과 비밀번호를 확인해주세요." }, { status: 400 });
    }

    const email =
      String(
        body.email ?? ""
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        body.password ?? ""
      );

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 || password.length > 1024) {
      return NextResponse.json({ message: "이메일 또는 비밀번호 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const accountLimit = rateLimit("login-email", 10, 15 * 60_000, email);
    if (accountLimit) return accountLimit;

    /* =========================
       검증
    ========================== */

    if (
      !email ||
      !password
    ) {
      return NextResponse.json(
        {
          success: false,

          message:
            "이메일과 비밀번호를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    /* =========================
       사용자 검색
    ========================== */

    const user =
      await prisma.users.findUnique({
        where: {
          email,
        },
      });

    /*
     * 이메일 존재 여부를
     * 너무 구체적으로 알려주지 않음
     */
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

    /* =========================
       비밀번호 확인
    ========================== */

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

    /* =========================
       SESSION TOKEN
    ========================== */

    const token =
      await createSessionToken(
        user.id.toString()
      );

    /* =========================
       HTTP ONLY COOKIE
    ========================== */

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

        sameSite: "lax",

        path: "/",

        maxAge:
          SESSION_DURATION,
      }
    );

    /* =========================
       응답
    ========================== */

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
          "로그인 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}