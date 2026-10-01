import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


export async function POST(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { id } = await params;

    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { message: "잘못된 친구 요청입니다." },
        { status: 400 }
      );
    }

    const affected = await prisma.$executeRaw`
      UPDATE friendships
      SET status = 'ACCEPTED'
      WHERE
        id = ${BigInt(id)}
        AND receiver_id = ${userId}
        AND status = 'PENDING'
    `;

    if (affected === 0) {
      return NextResponse.json(
        {
          message:
            "수락할 수 없는 친구 요청입니다. 이미 처리됐거나 요청 대상이 아닐 수 있습니다.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      friendshipId: id,
      message: "친구 요청을 수락했습니다.",
    });
  } catch (error) {
    console.error("Friend accept error:", error);

    return NextResponse.json(
      {
        message:
          "친구 요청 수락 중 서버 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
