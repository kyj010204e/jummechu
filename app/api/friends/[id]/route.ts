import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type FriendshipRow = {
  id: bigint;
};


type PreferenceRow = {
  id: bigint;
  name: string;
  weight: number;
};


export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
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
      id: friendIdText,
    } = await params;

    if (
      !/^\d+$/.test(
        friendIdText
      )
    ) {
      return NextResponse.json(
        {
          message:
            "잘못된 친구 정보입니다.",
        },
        {
          status: 400,
        }
      );
    }

    const friendId =
      BigInt(friendIdText);

    if (
      friendId === userId
    ) {
      return NextResponse.json(
        {
          message:
            "자기 자신은 친구 상세 화면으로 볼 수 없습니다.",
        },
        {
          status: 400,
        }
      );
    }

    const friendship =
      await prisma.$queryRaw<
        FriendshipRow[]
      >`
        SELECT id
        FROM friendships
        WHERE
          status = 'ACCEPTED'
          AND (
            (
              requester_id = ${userId}
              AND receiver_id = ${friendId}
            )
            OR
            (
              requester_id = ${friendId}
              AND receiver_id = ${userId}
            )
          )
        LIMIT 1
      `;

    if (
      friendship.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "친구 관계가 아닙니다.",
        },
        {
          status: 403,
        }
      );
    }

    const friend =
      await prisma.users.findUnique({
        where: {
          id: friendId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          profile_image_url: true,
        },
      });

    if (!friend) {
      return NextResponse.json(
        {
          message:
            "친구 정보를 찾을 수 없습니다.",
        },
        {
          status: 404,
        }
      );
    }

    const [
      myPreferences,
      friendPreferences,
    ] = await Promise.all([
      prisma.$queryRaw<
        PreferenceRow[]
      >`
        SELECT
          f.id,
          f.name,
          ufp.weight
        FROM user_food_preferences ufp
        JOIN foods f
          ON f.id = ufp.food_id
        WHERE ufp.user_id = ${userId}
        ORDER BY
          ufp.weight DESC,
          f.name ASC
      `,

      prisma.$queryRaw<
        PreferenceRow[]
      >`
        SELECT
          f.id,
          f.name,
          ufp.weight
        FROM user_food_preferences ufp
        JOIN foods f
          ON f.id = ufp.food_id
        WHERE ufp.user_id = ${friendId}
        ORDER BY
          ufp.weight DESC,
          f.name ASC
      `,
    ]);

    const myMap =
      new Map(
        myPreferences.map(
          (item) => [
            item.id.toString(),
            item,
          ]
        )
      );

    const commonPreferences =
      friendPreferences
        .filter(
          (item) =>
            myMap.has(
              item.id.toString()
            )
        )
        .map((item) => {
          const mine =
            myMap.get(
              item.id.toString()
            )!;

          return {
            id:
              item.id.toString(),
            name:
              item.name,
            myWeight:
              Number(mine.weight),
            friendWeight:
              Number(item.weight),
            bothFavorite:
              Number(mine.weight) >= 2 &&
              Number(item.weight) >= 2,
          };
        })
        .sort((a, b) => {
          if (
            a.bothFavorite !==
            b.bothFavorite
          ) {
            return a.bothFavorite
              ? -1
              : 1;
          }

          return a.name.localeCompare(
            b.name,
            "ko"
          );
        });

    return NextResponse.json({
      friend: {
        id:
          friend.id.toString(),
        name:
          friend.name,
        email:
          friend.email,
        profileImageUrl:
          friend.profile_image_url,
      },

      myPreferences:
        myPreferences.map(
          (item) => ({
            id:
              item.id.toString(),
            name:
              item.name,
            weight:
              Number(item.weight),
            favorite:
              Number(item.weight) >= 2,
          })
        ),

      friendPreferences:
        friendPreferences.map(
          (item) => ({
            id:
              item.id.toString(),
            name:
              item.name,
            weight:
              Number(item.weight),
            favorite:
              Number(item.weight) >= 2,
          })
        ),

      commonPreferences,
    });

  } catch (error) {
    console.error(
      "Friend detail GET error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "친구 취향 정보를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
