import { NextRequest, NextResponse } from "next/server";

import { ensureMealHistoryTable } from "@/lib/meal-history";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";
import {
  rebuildUserTasteEmbeddingWithFeedback,
  upsertRecommendationFeedback,
} from "@/lib/taste-feedback";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { id: idText } = await params;

    if (!/^\d+$/.test(idText)) {
      return NextResponse.json(
        { message: "잘못된 먹어보기 기록입니다." },
        { status: 400 }
      );
    }

    const limited = rateLimit(
      "meal-history-rating-user",
      40,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as
      | { rating?: unknown }
      | null;

    const rating: 1 | -1 | null =
      body?.rating === 1 || body?.rating === "like"
        ? 1
        : body?.rating === -1 || body?.rating === "dislike"
          ? -1
          : null;

    if (!rating) {
      return NextResponse.json(
        { message: "평가는 좋아요 또는 별로예요 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    await ensureMealHistoryTable();

    const rows = await prisma.$queryRaw<
      Array<{
        id: bigint;
        food_id: bigint | null;
        menu_name: string | null;
      }>
    >`
      SELECT id, food_id, menu_name
      FROM meal_history
      WHERE id = ${BigInt(idText)}
        AND user_id = ${userId}
      LIMIT 1
    `;

    const entry = rows[0];

    if (!entry) {
      return NextResponse.json(
        { message: "먹어보기 기록을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    await prisma.$executeRaw`
      UPDATE meal_history
      SET
        rating = ${rating},
        rated_at = CURRENT_TIMESTAMP
      WHERE id = ${entry.id}
        AND user_id = ${userId}
    `;

    let tasteUpdated = false;

    if (entry.food_id) {
      const saved = await upsertRecommendationFeedback({
        userId,
        foodId: entry.food_id,
        rating,
        source: "meal_history",
      });

      if (saved) {
        tasteUpdated =
          await rebuildUserTasteEmbeddingWithFeedback(userId);
      }
    }

    return NextResponse.json({
      success: true,
      id: idText,
      rating,
      tasteUpdated,
      message:
        tasteUpdated
          ? rating === 1
            ? "좋았어요 평가를 저장했고 다음 추천에 조금 더 반영할게요."
            : "별로였어요 평가를 저장했고 비슷한 메뉴의 비중을 조금 낮출게요."
          : "평가를 기록했어요. 이 메뉴는 Food Master와 직접 연결되지 않아 취향 벡터는 그대로 유지돼요.",
    });
  } catch (error) {
    console.error("Meal history PATCH error:", error);

    return NextResponse.json(
      { message: "먹어보기 평가를 저장하지 못했습니다." },
      { status: 500 }
    );
  }
}
