import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type ExistingFriendship = {
  id: bigint;
  requester_id: bigint;
  receiver_id: bigint;
  status: string;
};


export async function POST(
  request: Request
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


    const body =
      await request
        .json()
        .catch(() => null);


    const email =
      typeof body?.email === "string"
        ? body.email
            .trim()
            .toLowerCase()
        : "";


    if (!email) {
      return NextResponse.json(
        {
          message:
            "친구 이메일을 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }


    const target =
      await prisma.users.findUnique({
        where: {
          email,
        },

        select: {
          id: true,
          name: true,
          email: true,
        },
      });


    if (!target) {
      return NextResponse.json(
        {
          message:
            "해당 이메일의 사용자를 찾을 수 없습니다.",
        },
        {
          status: 404,
        }
      );
    }


    if (
      target.id === userId
    ) {
      return NextResponse.json(
        {
          message:
            "자기 자신에게 친구 요청을 보낼 수 없습니다.",
        },
        {
          status: 400,
        }
      );
    }


    const existing =
      await prisma.$queryRaw<
        ExistingFriendship[]
      >`
        SELECT
          id,
          requester_id,
          receiver_id,
          status

        FROM friendships

        WHERE
          (
            requester_id = ${userId}
            AND
            receiver_id = ${target.id}
          )

          OR

          (
            requester_id = ${target.id}
            AND
            receiver_id = ${userId}
          )

        LIMIT 1
      `;


    const current =
      existing[0];


    if (current) {

      if (
        current.status ===
        "ACCEPTED"
      ) {
        return NextResponse.json(
          {
            message:
              "이미 친구입니다.",
          },
          {
            status: 409,
          }
        );
      }


      if (
        current.status ===
        "PENDING"
      ) {

        if (
          current.receiver_id ===
          userId
        ) {
          return NextResponse.json(
            {
              message:
                "상대방이 이미 친구 요청을 보냈습니다. 받은 요청에서 수락해주세요.",
            },
            {
              status: 409,
            }
          );
        }


        return NextResponse.json(
          {
            message:
              "이미 친구 요청을 보냈습니다.",
          },
          {
            status: 409,
          }
        );
      }


      /*
       * 과거 거절된 요청이면
       * 같은 row 재사용
       */
      await prisma.$executeRaw`
        UPDATE friendships

        SET
          requester_id = ${userId},
          receiver_id = ${target.id},
          status = 'PENDING',
          updated_at = CURRENT_TIMESTAMP

        WHERE
          id = ${current.id}
      `;

    } else {

      await prisma.$executeRaw`
        INSERT INTO friendships
        (
          requester_id,
          receiver_id,
          status
        )

        VALUES
        (
          ${userId},
          ${target.id},
          'PENDING'
        )
      `;
    }


    return NextResponse.json({
      success: true,

      message:
        `${target.name}님에게 친구 요청을 보냈습니다.`,
    });

  } catch (error) {
    console.error(
      "Friend request error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "친구 요청 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}