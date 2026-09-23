import { parseCoordinate, parseName } from "@/lib/validation";
import {
  NextResponse,
} from "next/server";


import {
  prisma,
} from "@/lib/prisma";

import { getUserId } from "@/lib/session";

/* =========================================================
   로그인 사용자 ID
========================================================= */



/* =========================================================
   GET
   저장된 위치 조회
========================================================= */

export async function GET() {
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

    const locations =
      await prisma.saved_locations.findMany({
        where: {
          user_id:
            userId,
        },

        orderBy: {
          id: "asc",
        },
      });

    return NextResponse.json({
      success: true,

      locations:
        locations.map(
          (location) => ({
            id:
              location.id.toString(),

            name:
              location.name,

            latitude:
              location.latitude,

            longitude:
              location.longitude,

            createdAt:
              location.created_at,
          })
        ),
    });
  } catch (error) {
    console.error(
      "GET SAVED LOCATIONS ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "저장된 위치를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
   POST
   새 위치 저장
========================================================= */

export async function POST(
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

    const body = await request.json().catch(() => null);
    const name = parseName(body?.name);
    const latitude = parseCoordinate(body?.latitude, "latitude");
    const longitude = parseCoordinate(body?.longitude, "longitude");
    if (!name || latitude === null || longitude === null) {
      return NextResponse.json({ message: "1~100자의 위치 이름과 올바른 좌표를 입력해주세요." }, { status: 400 });
    }

    const location =
      await prisma.saved_locations.create({
        data: {
          user_id:
            userId,

          name,

          latitude,

          longitude,
        },
      });

    return NextResponse.json(
      {
        success: true,

        location: {
          id:
            location.id.toString(),

          name:
            location.name,

          latitude:
            location.latitude,

          longitude:
            location.longitude,
        },
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error(
      "POST SAVED LOCATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "위치 저장 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}