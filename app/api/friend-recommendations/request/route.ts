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


type HistoryRow = {
  id: bigint;
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

    const [existing, completedHistory] = await Promise.all([
      prisma.$queryRaw<SessionRow[]>`
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
      `,

      prisma.$queryRaw<HistoryRow[]>`
        SELECT id
        FROM friend_recommendation_sessions
        WHERE
          status = 'COMPLETED'
          AND (
            (requester_id = ${userId} AND friend_id = ${friendId})
            OR
            (requester_id = ${friendId} AND friend_id = ${userId})
          )
        ORDER BY completed_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
    ]);

    const hasCompletedHistory =
      completedHistory.length > 0;

    /*
     * 진행 중인 세션이 있으면 새 세션을 중복 생성하지 않습니다.
     */
    if (existing.length > 0) {
      const current = existing[0];

      if (current.status === "ACCEPTED") {
        return NextResponse.json(
          {
            message: "이미 진행 중인 같이 먹기가 있습니다.",
            sessionId: current.id.toString(),
            active: true,
          },
          { status: 409 }
        );
      }

      /*
       * 이미 한 번 완료한 사이인데 예전 방식의 PENDING 요청이 남아 있다면
       * 다시 승인받게 하지 않고 그 요청을 즉시 ACCEPTED로 전환합니다.
       */
      if (hasCompletedHistory) {
        const accepted = await prisma.$queryRaw<SessionRow[]>`
          UPDATE friend_recommendation_sessions
          SET
            status = 'ACCEPTED',
            accepted_at = CURRENT_TIMESTAMP,
            rejected_at = NULL,
            completed_at = NULL
          WHERE
            id = ${current.id}
            AND status = 'PENDING'
          RETURNING
            id,
            requester_id,
            friend_id,
            status
        `;

        if (accepted[0]) {
          return NextResponse.json({
            success: true,
            autoAccepted: true,
            reusedPending: true,
            sessionId: accepted[0].id.toString(),
            message: "이전에 같이 먹은 기록이 있어 바로 새 추천을 시작합니다.",
          });
        }
      }

      if (current.friend_id === userId) {
        return NextResponse.json(
          {
            message: "친구가 이미 공통메뉴 추천 요청을 보냈습니다. 친구 페이지에서 수락해주세요.",
            sessionId: current.id.toString(),
            pendingDirection: "incoming",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          message: "이미 공통메뉴 추천 요청을 보냈습니다.",
          sessionId: current.id.toString(),
          pendingDirection: "outgoing",
        },
        { status: 409 }
      );
    }

    const friend = await prisma.users.findUnique({
      where: { id: friendId },
      select: { name: true },
    });

    /*
     * 한 번이라도 COMPLETED 이력이 있는 친구라면
     * 두 번째부터는 상대방 재승인 없이 새 ACCEPTED 세션을 생성합니다.
     * 기존 COMPLETED 행은 그대로 남아 히스토리를 보존합니다.
     */
    if (hasCompletedHistory) {
      const created = await prisma.$queryRaw<SessionRow[]>`
        INSERT INTO friend_recommendation_sessions
        (
          requester_id,
          friend_id,
          status,
          accepted_at
        )
        VALUES
        (
          ${userId},
          ${friendId},
          'ACCEPTED',
          CURRENT_TIMESTAMP
        )
        RETURNING
          id,
          requester_id,
          friend_id,
          status
      `;

      return NextResponse.json({
        success: true,
        autoAccepted: true,
        sessionId: created[0].id.toString(),
        message: `${friend?.name ?? "친구"}님과 바로 새 같이 먹기를 시작합니다.`,
      });
    }

    /*
     * 처음 같이 먹는 친구는 기존처럼 상대방의 수락을 받습니다.
     */
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

    return NextResponse.json({
      success: true,
      autoAccepted: false,
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
