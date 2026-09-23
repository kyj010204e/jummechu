import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { removeProfileImage } from "@/lib/profile-files";
import { rateLimit } from "@/lib/rate-limit";

import { prisma } from "@/lib/prisma";

import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { getUserId } from "@/lib/session";

/* =========================================================
   현재 로그인 사용자 ID 가져오기
========================================================= */



/* =========================================================
   DELETE /api/account

   비밀번호 확인 후 회원탈퇴
========================================================= */

export async function DELETE(
  request: Request
) {
  try {
    const userId =
      await getUserId();

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "로그인이 필요합니다.",
        },
        {
          status: 401,
        }
      );
    }

    const limited = rateLimit("account-delete", 10, 15 * 60_000, userId.toString());
    if (limited) return limited;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.password !== "string") return NextResponse.json({ message: "비밀번호를 입력해주세요." }, { status: 400 });

    const password =
      String(
        body.password ?? ""
      );

    if (!password) {
      return NextResponse.json(
        {
          success: false,
          message:
            "비밀번호를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    /* =========================
       사용자 조회
    ========================== */

    const user =
      await prisma.users.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message:
            "사용자를 찾을 수 없습니다.",
        },
        {
          status: 404,
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
            "비밀번호가 올바르지 않습니다.",
        },
        {
          status: 401,
        }
      );
    }

    /* =========================
       회원 삭제

       FK가 ON DELETE CASCADE이므로
       선호도 / 저장 위치 / 즐겨찾기도
       자동 삭제됨
    ========================== */

    const deletedUser = await prisma.users.delete({
      where: {
        id: userId,
      },
    });

    await removeProfileImage(deletedUser.profile_image_url);

    /* =========================
       세션 쿠키 삭제
    ========================== */

    const cookieStore =
      await cookies();

    cookieStore.set(
      SESSION_COOKIE_NAME,
      "",
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite: "lax",

        path: "/",

        maxAge: 0,
      }
    );

    return NextResponse.json({
      success: true,
      message:
        "회원탈퇴가 완료되었습니다.",
    });
  } catch (error) {
    console.error(
      "DELETE ACCOUNT ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "회원탈퇴 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}