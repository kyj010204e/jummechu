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
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";

export async function GET() {
  try {
    const cookieStore =
      await cookies();

    const token =
      cookieStore.get(
        SESSION_COOKIE_NAME
      )?.value;

    if (!token) {
      return NextResponse.json(
        {
          authenticated:
            false,

          user: null,
        },
        {
          status: 401,
        }
      );
    }

    const session =
      await verifySessionToken(
        token
      );

    if (!session) {
      return NextResponse.json(
        {
          authenticated:
            false,

          user: null,
        },
        {
          status: 401,
        }
      );
    }

    /* =========================
       실제 DB 사용자 확인
    ========================== */

    const user =
      await prisma.users.findUnique({
        where: {
          id:
            BigInt(
              session.userId
            ),
        },

        select: {
          id: true,
          name: true,
          email: true,
      
          profile_avatar_key: true,
          profile_image_url: true,

          created_at: true,
        },
      });

    if (!user) {
      return NextResponse.json(
        {
          authenticated:
            false,

          user: null,
        },
        {
          status: 401,
        }
      );
    }

    return NextResponse.json({
      authenticated: true,

      user: {
        id:
          user.id.toString(),

        name:
          user.name,

        email:
          user.email,

        profileAvatarKey:
          user.profile_avatar_key,

        profileImageUrl:
          user.profile_image_url,

        createdAt:
          user.created_at,
      },
    });
  } catch (error) {
    console.error(
      "ME ERROR:",
      error
    );

    return NextResponse.json(
      {
        authenticated:
          false,

        user: null,
      },
      {
        status: 500,
      }
    );
  }
}