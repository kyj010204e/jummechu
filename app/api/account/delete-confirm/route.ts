import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

import {
  getUserId,
} from "@/lib/session";

import {
  AccountDeletionError,
  deleteAccountWithCode,
} from "@/lib/account-deletion";


export async function DELETE(
  request: NextRequest
) {
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

    const body =
      await request.json()
        .catch(
          () => ({})
        ) as {
          code?: unknown;
        };

    const code =
      typeof body.code ===
        "string"
        ? body.code.trim()
        : "";

    await deleteAccountWithCode(
      userId,
      code
    );

    const response =
      NextResponse.json({
        success: true,
        message:
          "회원탈퇴가 완료되었습니다.",
      });

    response.cookies.set(
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

    return response;
  } catch (error) {
    if (
      error instanceof
      AccountDeletionError
    ) {
      return NextResponse.json(
        {
          message: error.message,
        },
        {
          status: error.status,
        }
      );
    }

    console.error(
      "Account deletion confirm error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "회원탈퇴 처리 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
