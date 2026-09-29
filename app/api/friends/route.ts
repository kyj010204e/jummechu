import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type FriendRow = {
  friendship_id: bigint;
  friend_id: bigint;
  name: string;
  email: string;
  profile_image_url: string | null;
};


type PendingRow = {
  friendship_id: bigint;
  user_id: bigint;
  name: string;
  email: string;
};


export async function GET() {
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


    /* =========================================
       수락된 친구
    ========================================= */

    const friends =
      await prisma.$queryRaw<
        FriendRow[]
      >`
        SELECT
          f.id AS friendship_id,

          CASE
            WHEN f.requester_id = ${userId}
              THEN receiver.id
            ELSE requester.id
          END AS friend_id,

          CASE
            WHEN f.requester_id = ${userId}
              THEN receiver.name
            ELSE requester.name
          END AS name,

          CASE
            WHEN f.requester_id = ${userId}
              THEN receiver.email
            ELSE requester.email
          END AS email,

          CASE
            WHEN f.requester_id = ${userId}
              THEN receiver.profile_image_url
            ELSE requester.profile_image_url
          END AS profile_image_url

        FROM friendships f

        JOIN users requester
          ON requester.id =
             f.requester_id

        JOIN users receiver
          ON receiver.id =
             f.receiver_id

        WHERE
          f.status = 'ACCEPTED'

          AND (
            f.requester_id = ${userId}
            OR
            f.receiver_id = ${userId}
          )

        ORDER BY
          f.updated_at DESC
      `;


    /* =========================================
       내가 받은 요청
    ========================================= */

    const incoming =
      await prisma.$queryRaw<
        PendingRow[]
      >`
        SELECT
          f.id AS friendship_id,
          u.id AS user_id,
          u.name,
          u.email

        FROM friendships f

        JOIN users u
          ON u.id =
             f.requester_id

        WHERE
          f.receiver_id = ${userId}

          AND
          f.status = 'PENDING'

        ORDER BY
          f.created_at DESC
      `;


    /* =========================================
       내가 보낸 요청
    ========================================= */

    const outgoing =
      await prisma.$queryRaw<
        PendingRow[]
      >`
        SELECT
          f.id AS friendship_id,
          u.id AS user_id,
          u.name,
          u.email

        FROM friendships f

        JOIN users u
          ON u.id =
             f.receiver_id

        WHERE
          f.requester_id = ${userId}

          AND
          f.status = 'PENDING'

        ORDER BY
          f.created_at DESC
      `;


    return NextResponse.json({
      friends:
        friends.map(
          (row) => ({
            friendshipId:
              row.friendship_id.toString(),

            id:
              row.friend_id.toString(),

            name:
              row.name,

            email:
              row.email,

            profileImageUrl:
              row.profile_image_url,
          })
        ),

      incomingRequests:
        incoming.map(
          (row) => ({
            friendshipId:
              row.friendship_id.toString(),

            id:
              row.user_id.toString(),

            name:
              row.name,

            email:
              row.email,
          })
        ),

      outgoingRequests:
        outgoing.map(
          (row) => ({
            friendshipId:
              row.friendship_id.toString(),

            id:
              row.user_id.toString(),

            name:
              row.name,

            email:
              row.email,
          })
        ),
    });

  } catch (error) {
    console.error(
      "Friends GET error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "친구 목록을 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}