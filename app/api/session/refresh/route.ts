import {
  NextResponse,
} from "next/server";

import {
  cookies,
} from "next/headers";

import {
  prisma,
} from "@/lib/prisma";

import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore =
      await cookies();

    const oldToken =
      cookieStore.get(
        SESSION_COOKIE_NAME
      )?.value;

    if (!oldToken) {
      return NextResponse.json(
        {
          authenticated: false,
        },
        {
          status: 401,
        }
      );
    }

    /*
     * 기존 세션 검증
     */
    const session =
      await verifySessionToken(
        oldToken
      );

    if (!session) {
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

      return NextResponse.json(
        {
          authenticated: false,
        },
        {
          status: 401,
        }
      );
    }

    /*
     * 실제 사용자가 DB에도 존재하는지 확인
     */
    const user =
      await prisma.users.findUnique({
        where: {
          id: BigInt(
            session.userId
          ),
        },

        select: {
          id: true,
        },
      });

    if (!user) {
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

      return NextResponse.json(
        {
          authenticated: false,
        },
        {
          status: 401,
        }
      );
    }

    /*
     * 새 14일짜리 토큰 발급
     *
     * 여기서 만료시간이 다시
     * 지금 + 14일로 연장됨
     */
    const newToken =
      await createSessionToken(
        user.id.toString()
      );

    cookieStore.set(
      SESSION_COOKIE_NAME,
      newToken,
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

    return NextResponse.json({
      authenticated: true,
    });
  } catch (error) {
    console.error(
      "SESSION REFRESH ERROR:",
      error
    );

    return NextResponse.json(
      {
        authenticated: false,
      },
      {
        status: 500,
      }
    );
  }
}