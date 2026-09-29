import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type RecommendationRequestRow = {
  session_id: bigint;
  user_id: bigint;
  name: string;
  email: string;
  created_at: Date;
};


type ActiveSessionRow = {
  session_id: bigint;
  user_id: bigint;
  name: string;
  email: string;
  accepted_at: Date | null;
};


type CompletedSessionRow = {
  session_id: bigint;
  user_id: bigint;
  name: string;
  email: string;
  accepted_at: Date | null;
  completed_at: Date | null;
};


export async function GET() {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const [incoming, outgoing, active, completed] =
      await Promise.all([
        prisma.$queryRaw<RecommendationRequestRow[]>`
          SELECT
            s.id AS session_id,
            u.id AS user_id,
            u.name,
            u.email,
            s.created_at
          FROM friend_recommendation_sessions s
          JOIN users u
            ON u.id = s.requester_id
          WHERE
            s.friend_id = ${userId}
            AND s.status = 'PENDING'
          ORDER BY s.created_at DESC
        `,

        prisma.$queryRaw<RecommendationRequestRow[]>`
          SELECT
            s.id AS session_id,
            u.id AS user_id,
            u.name,
            u.email,
            s.created_at
          FROM friend_recommendation_sessions s
          JOIN users u
            ON u.id = s.friend_id
          WHERE
            s.requester_id = ${userId}
            AND s.status = 'PENDING'
          ORDER BY s.created_at DESC
        `,

        prisma.$queryRaw<ActiveSessionRow[]>`
          SELECT
            s.id AS session_id,
            other_user.id AS user_id,
            other_user.name,
            other_user.email,
            s.accepted_at
          FROM friend_recommendation_sessions s
          JOIN users other_user
            ON other_user.id = CASE
              WHEN s.requester_id = ${userId}
                THEN s.friend_id
              ELSE s.requester_id
            END
          WHERE
            s.status = 'ACCEPTED'
            AND (
              s.requester_id = ${userId}
              OR s.friend_id = ${userId}
            )
          ORDER BY s.accepted_at DESC NULLS LAST
          LIMIT 20
        `,

        prisma.$queryRaw<CompletedSessionRow[]>`
          SELECT
            s.id AS session_id,
            other_user.id AS user_id,
            other_user.name,
            other_user.email,
            s.accepted_at,
            s.completed_at
          FROM friend_recommendation_sessions s
          JOIN users other_user
            ON other_user.id = CASE
              WHEN s.requester_id = ${userId}
                THEN s.friend_id
              ELSE s.requester_id
            END
          WHERE
            s.status = 'COMPLETED'
            AND (
              s.requester_id = ${userId}
              OR s.friend_id = ${userId}
            )
          ORDER BY s.completed_at DESC NULLS LAST, s.id DESC
          LIMIT 100
        `,
      ]);

    return NextResponse.json({
      incomingRequests: incoming.map((item) => ({
        sessionId: item.session_id.toString(),
        userId: item.user_id.toString(),
        name: item.name,
        email: item.email,
        createdAt: item.created_at,
      })),

      outgoingRequests: outgoing.map((item) => ({
        sessionId: item.session_id.toString(),
        userId: item.user_id.toString(),
        name: item.name,
        email: item.email,
        createdAt: item.created_at,
      })),

      activeSessions: active.map((item) => ({
        sessionId: item.session_id.toString(),
        userId: item.user_id.toString(),
        name: item.name,
        email: item.email,
        acceptedAt: item.accepted_at,
      })),

      completedSessions: completed.map((item) => ({
        sessionId: item.session_id.toString(),
        userId: item.user_id.toString(),
        name: item.name,
        email: item.email,
        acceptedAt: item.accepted_at,
        completedAt: item.completed_at,
      })),
    });
  } catch (error) {
    console.error("Friend recommendations GET error:", error);

    return NextResponse.json(
      { message: "공통메뉴 추천 요청을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
