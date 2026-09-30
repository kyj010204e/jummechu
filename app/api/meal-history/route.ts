import { NextRequest, NextResponse } from "next/server";

import {
  createMealHistoryEntry,
  ensureMealHistoryTable,
} from "@/lib/meal-history";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    await ensureMealHistoryTable();

    const summary =
      request.nextUrl.searchParams.get("summary") === "1";

    if (summary) {
      const rows = await prisma.$queryRaw<
        Array<{
          restaurant_key: string;
          visit_count: number;
          last_tried_at: Date;
        }>
      >`
        SELECT
          restaurant_key,
          COUNT(*)::int AS visit_count,
          MAX(tried_at) AS last_tried_at
        FROM meal_history
        WHERE user_id = ${userId}
        GROUP BY restaurant_key
        ORDER BY last_tried_at DESC
      `;

      return NextResponse.json({
        restaurants: rows.map((row) => ({
          restaurantKey: row.restaurant_key,
          visitCount: Number(row.visit_count),
          lastTriedAt: row.last_tried_at.toISOString(),
        })),
      });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: bigint;
        restaurant_key: string;
        restaurant_name: string;
        road_address: string;
        address: string;
        food_id: bigint | null;
        menu_name: string | null;
        source: string;
        rating: number | null;
        tried_at: Date;
        rated_at: Date | null;
      }>
    >`
      SELECT
        id,
        restaurant_key,
        restaurant_name,
        road_address,
        address,
        food_id,
        menu_name,
        source,
        rating,
        tried_at,
        rated_at
      FROM meal_history
      WHERE user_id = ${userId}
      ORDER BY tried_at DESC, id DESC
      LIMIT 300
    `;

    return NextResponse.json({
      history: rows.map((row) => ({
        id: row.id.toString(),
        restaurantKey: row.restaurant_key,
        restaurantName: row.restaurant_name,
        roadAddress: row.road_address,
        address: row.address,
        foodId: row.food_id?.toString() ?? null,
        menuName: row.menu_name,
        source:
          row.source === "exploration"
            ? "exploration"
            : "recommendation",
        rating:
          row.rating === 1
            ? 1
            : row.rating === -1
              ? -1
              : null,
        triedAt: row.tried_at.toISOString(),
        ratedAt: row.rated_at?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Meal history GET error:", error);

    return NextResponse.json(
      { message: "먹어보기 기록을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const limited = rateLimit(
      "meal-history-user",
      40,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as
      | {
          clientAttemptId?: unknown;
          restaurantKey?: unknown;
          restaurantName?: unknown;
          roadAddress?: unknown;
          address?: unknown;
          foodId?: unknown;
          menuName?: unknown;
          source?: unknown;
        }
      | null;

    const entry = await createMealHistoryEntry({
      userId,
      clientAttemptId: body?.clientAttemptId,
      restaurantKey: body?.restaurantKey,
      restaurantName: body?.restaurantName,
      roadAddress: body?.roadAddress,
      address: body?.address,
      foodId: body?.foodId,
      menuName: body?.menuName,
      source: body?.source,
    });

    if (!entry) {
      return NextResponse.json(
        { message: "먹어보기 기록에 필요한 음식점 정보가 부족합니다." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      entry,
      message: "먹어보기 기록에 추가했어요. 식사 후 평가를 남겨주세요.",
    });
  } catch (error) {
    console.error("Meal history POST error:", error);

    return NextResponse.json(
      { message: "먹어보기 기록을 저장하지 못했습니다." },
      { status: 500 }
    );
  }
}
