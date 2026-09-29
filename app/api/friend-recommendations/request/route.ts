import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type FriendshipRow = {
  id: bigint;
};


type SessionRow = {
  id: bigint;
  requester_id: bigint;
  friend_id: bigint;
  status: string;
};


export async function POST(request: Request) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    const friendIdText = String(body?.friendId ?? "");

    if (!/^\d+$/.test(friendIdText)) {
      return NextResponse.json(
        { message: "잘못된 친구 정보입니다." },
        { status: 400 }
      );
    }

    const friendId = BigInt(friendIdText);

    if (friendId === userId) {
      return NextResponse.json(
        { message: "자기 자신에게 공통메뉴 추천 요청을 보낼 수 없습니다." },
        { status: 400 }
      );
    }

    const friendship = await prisma.$queryRaw<FriendshipRow[]>`
      SELECT id
      FROM friendships
      WHERE
        status = 'ACCEPTED'
        AND (
          (requester_id = ${userId} AND receiver_id = ${friendId})
          OR
          (requester_id = ${friendId} AND receiver_id = ${userId})
        )
      LIMIT 1
    `;

    if (friendship.length === 0) {
      return NextResponse.json(
        { message: "친구에게만 공통메뉴 추천을 요청할 수 있습니다." },
        { status: 403 }
      );
    }

    /*
     * 같은 친구와는 진행 중인 ACCEPTED 세션을 먼저 끝낸 뒤
     * 새 같이 먹기를 시작하도록 합니다.
     * 이 조건이 있어야 메인 친구 페이지에 동일한 카드가 계속 쌓이지 않습니다.
     */
    const existing = await prisma.$queryRaw<SessionRow[]>`
      SELECT
        id,
        requester_id,
        friend_id,
        status
      FROM friend_recommendation_sessions
      WHERE
        status IN ('PENDING', 'ACCEPTED')
        AND (
          (requester_id = ${userId} AND friend_id = ${friendId})
          OR
          (requester_id = ${friendId} AND friend_id = ${userId})
        )
      ORDER BY
        CASE WHEN status = 'ACCEPTED' THEN 0 ELSE 1 END,
        id DESC
      LIMIT 1
    `;

    if (existing.length > 0) {
      const current = existing[0];

      if (current.status === "ACCEPTED") {
        return NextResponse.json(
          {
            message: "이미 진행 중인 같이 먹기가 있습니다. 먼저 완료한 뒤 새로 요청해주세요.",
            sessionId: current.id.toString(),
            active: true,
          },
          { status: 409 }
        );
      }

      if (current.friend_id === userId) {
        return NextResponse.json(
          {
            message: "친구가 이미 공통메뉴 추천 요청을 보냈습니다. 친구 페이지에서 수락해주세요.",
            sessionId: current.id.toString(),
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          message: "이미 공통메뉴 추천 요청을 보냈습니다.",
          sessionId: current.id.toString(),
        },
        { status: 409 }
      );
    }

    const created = await prisma.$queryRaw<SessionRow[]>`
      INSERT INTO friend_recommendation_sessions
      (
        requester_id,
        friend_id,
        status
      )
      VALUES
      (
        ${userId},
        ${friendId},
        'PENDING'
      )
      RETURNING
        id,
        requester_id,
        friend_id,
        status
    `;

    const friend = await prisma.users.findUnique({
      where: { id: friendId },
      select: { name: true },
    });

    return NextResponse.json({
      success: true,
      sessionId: created[0].id.toString(),
      message: `${friend?.name ?? "친구"}님에게 공통메뉴 추천 요청을 보냈습니다.`,
    });
  } catch (error) {
    console.error("Friend recommendation request error:", error);

    return NextResponse.json(
      { message: "공통메뉴 추천 요청 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
