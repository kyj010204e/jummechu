import { rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";

export async function POST(
  request: Request
) {
  try {
    const limited = rateLimit("signup-global", 60, 60_000);
    if (limited) return limited;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ message: "이메일과 비밀번호를 확인해주세요." }, { status: 400 });
    }

    const name =
      String(
        body.name ?? ""
      ).trim();

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
    const accountLimit = rateLimit("signup-email", 10, 15 * 60_000, email);
    if (accountLimit) return accountLimit;

    /* =========================
       입력값 검증
    ========================== */

    if (
      !name ||
      !email ||
      !password
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "이름, 이메일, 비밀번호를 모두 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    if (typeof body.name !== "string" || name.length > 100 || Buffer.byteLength(password, "utf8") > 72) {
      return NextResponse.json({ message: "이름은 100자 이하, 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다." }, { status: 400 });
    }

    if (
      password.length < 8
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "비밀번호는 8자 이상이어야 합니다.",
        },
        {
          status: 400,
        }
      );
    }

    /* =========================
       이메일 중복 확인
    ========================== */

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

    /* =========================
       비밀번호 해시
    ========================== */

    const passwordHash =
      await bcrypt.hash(
        password,
        12
      );

    /* =========================
       사용자 생성
    ========================== */

    const user =
      await prisma.users.create({
        data: {
          name,

          email,

          password_hash:
            passwordHash,
        },
      });

    /* =========================
       로그인 세션 생성
    ========================== */

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

        sameSite: "lax",

        path: "/",

        maxAge:
          SESSION_DURATION,
      }
    );

    /* =========================
       응답
    ========================== */

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
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ message: "이미 가입된 이메일입니다." }, { status: 409 });
    }
    console.error(
      "SIGNUP ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "회원가입 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}