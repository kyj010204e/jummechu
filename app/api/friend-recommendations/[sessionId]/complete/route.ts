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
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { sessionId } = await params;

    if (!/^\d+$/.test(sessionId)) {
      return NextResponse.json(
        { message: "잘못된 추천 세션입니다." },
        { status: 400 }
      );
    }

    const updated = await prisma.$queryRaw<UpdatedRow[]>`
      UPDATE friend_recommendation_sessions
      SET
        status = 'COMPLETED',
        completed_at = CURRENT_TIMESTAMP
      WHERE
        id = ${BigInt(sessionId)}
        AND status = 'ACCEPTED'
        AND (
          requester_id = ${userId}
          OR friend_id = ${userId}
        )
      RETURNING id
    `;

    if (updated.length === 0) {
      return NextResponse.json(
        { message: "완료할 수 없는 같이 먹기 세션입니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: updated[0].id.toString(),
      message: "같이 먹기를 완료했습니다.",
    });
  } catch (error) {
    console.error("Friend recommendation complete error:", error);

    return NextResponse.json(
      { message: "같이 먹기 완료 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
