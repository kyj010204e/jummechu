import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type UpdatedRow = {
  id: bigint;
};


export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      sessionId: string;
    }>;
  }
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

    const {
      sessionId: sessionIdText,
    } = await params;

    if (
      !/^\d+$/.test(
        sessionIdText
      )
    ) {
      return NextResponse.json(
        {
          message:
            "잘못된 요청입니다.",
        },
        {
          status: 400,
        }
      );
    }

    const updated =
      await prisma.$queryRaw<
        UpdatedRow[]
      >`
        UPDATE friend_recommendation_sessions
        SET
          status = 'ACCEPTED',
          accepted_at = CURRENT_TIMESTAMP,
          rejected_at = NULL
        WHERE
          id = ${BigInt(sessionIdText)}
          AND friend_id = ${userId}
          AND status = 'PENDING'
        RETURNING id
      `;

    if (
      updated.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "수락할 수 없는 공통메뉴 추천 요청입니다.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId:
        updated[0].id.toString(),
      message:
        "공통메뉴 추천 요청을 수락했습니다.",
    });

  } catch (error) {
    console.error(
      "Friend recommendation accept error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "공통메뉴 추천 요청 수락 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
