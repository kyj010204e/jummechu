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
      friendshipId: string;
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
      friendshipId:
        friendshipIdText,
    } = await params;

    if (
      !/^\d+$/.test(
        friendshipIdText
      )
    ) {
      return NextResponse.json(
        {
          message:
            "잘못된 친구 요청입니다.",
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
        UPDATE friendships
        SET
          status = 'REJECTED',
          updated_at = CURRENT_TIMESTAMP
        WHERE
          id = ${BigInt(friendshipIdText)}
          AND receiver_id = ${userId}
          AND status = 'PENDING'
        RETURNING id
      `;

    if (
      updated.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "거절할 수 없는 친구 요청입니다. 이미 처리됐거나 요청 대상이 아닐 수 있습니다.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      success: true,
      friendshipId:
        updated[0].id.toString(),
      message:
        "친구 요청을 거절했습니다.",
    });

  } catch (error) {
    console.error(
      "Friend reject error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "친구 요청 거절 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
