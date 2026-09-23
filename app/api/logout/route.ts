import {
  NextResponse,
} from "next/server";

import {
  cookies,
} from "next/headers";

import {
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

export async function POST() {
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
      "로그아웃되었습니다.",
  });
}