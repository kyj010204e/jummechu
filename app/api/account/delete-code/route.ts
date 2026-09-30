import {
  NextResponse,
} from "next/server";

import {
  getUserId,
} from "@/lib/session";

import {
  AccountDeletionError,
  sendAccountDeletionCode,
} from "@/lib/account-deletion";


export async function POST() {
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

    const result =
      await sendAccountDeletionCode(
        userId
      );

    return NextResponse.json({
      success: true,
      email: result.email,
      expiresInSeconds:
        result.expiresInSeconds,
      message:
        "회원탈퇴 확인 인증번호를 이메일로 전송했습니다.",
    });
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
      "Account deletion code send error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "인증메일 전송 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
