import { NextRequest, NextResponse } from "next/server";

import {
  cleanMealHistoryText,
  ensureMealHistoryTable,
  normalizeMealHistoryRating,
} from "@/lib/meal-history";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";
import {
  ensureRecommendationFeedbackTable,
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
      "meal-history-update-user",
      60,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as
      | {
          rating?: unknown;
          privateComment?: unknown;
        }
      | null;

    const hasRating =
      !!body && Object.prototype.hasOwnProperty.call(body, "rating");
    const hasPrivateComment =
      !!body && Object.prototype.hasOwnProperty.call(body, "privateComment");

    const rating = hasRating
      ? normalizeMealHistoryRating(body?.rating)
      : null;

    if (hasRating && !rating) {
      return NextResponse.json(
        { message: "평가는 좋아요 또는 별로예요 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    if (!hasRating && !hasPrivateComment) {
      return NextResponse.json(
        { message: "변경할 평가나 개인 메모를 입력해주세요." },
        { status: 400 }
      );
    }

    const privateComment = hasPrivateComment
      ? cleanMealHistoryText(body?.privateComment, 1000)
      : null;

    await ensureMealHistoryTable();

    const rows = await prisma.$queryRaw<
      Array<{
        id: bigint;
        food_id: bigint | null;
        rating: number | null;
        private_comment: string;
      }>
    >`
      SELECT
        id,
        food_id,
        rating,
        private_comment
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

    if (hasPrivateComment) {
      await prisma.$executeRaw`
        UPDATE meal_history
        SET
          private_comment = ${privateComment ?? ""},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${entry.id}
          AND user_id = ${userId}
      `;
    }

    let tasteUpdated = false;

    if (hasRating && rating) {
      await prisma.$executeRaw`
        UPDATE meal_history
        SET
          rating = ${rating},
          rated_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${entry.id}
          AND user_id = ${userId}
      `;

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
    }

    return NextResponse.json({
      success: true,
      id: idText,
      rating: hasRating ? rating : entry.rating,
      privateComment:
        hasPrivateComment
          ? privateComment ?? ""
          : entry.private_comment ?? "",
      tasteUpdated,
      message:
        hasRating && hasPrivateComment
          ? "평가와 나만 보는 메모를 저장했어요."
          : hasRating
            ? tasteUpdated
              ? rating === 1
                ? "좋았어요 평가를 저장했고 다음 추천에 조금 더 반영할게요."
                : "별로였어요 평가를 저장했고 비슷한 메뉴의 비중을 조금 낮출게요."
              : "평가를 기록했어요."
            : "나만 보는 메모를 저장했어요.",
    });
  } catch (error) {
    console.error("Meal history PATCH error:", error);

    return NextResponse.json(
      { message: "먹어보기 기록을 수정하지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
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
      "meal-history-delete-user",
      30,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    await ensureMealHistoryTable();

    const rows = await prisma.$queryRaw<
      Array<{
        id: bigint;
        food_id: bigint | null;
        rating: number | null;
      }>
    >`
      SELECT id, food_id, rating
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
      DELETE FROM meal_history
      WHERE id = ${entry.id}
        AND user_id = ${userId}
    `;

    let tasteUpdated = false;

    /*
     * 삭제한 기록이 취향 학습에 사용됐던 평가라면,
     * 같은 메뉴의 남아 있는 최신 식사 평가로 되돌립니다.
     * 남은 평가가 없으면 meal_history가 만든 피드백만 제거합니다.
     */
    if (entry.food_id && (entry.rating === 1 || entry.rating === -1)) {
      const remaining = await prisma.$queryRaw<
        Array<{ rating: number }>
      >`
        SELECT rating
        FROM meal_history
        WHERE user_id = ${userId}
          AND food_id = ${entry.food_id}
          AND rating IN (-1, 1)
        ORDER BY rated_at DESC NULLS LAST, tried_at DESC, id DESC
        LIMIT 1
      `;

      const remainingRating = remaining[0]?.rating;

      if (remainingRating === 1 || remainingRating === -1) {
        await upsertRecommendationFeedback({
          userId,
          foodId: entry.food_id,
          rating: remainingRating === 1 ? 1 : -1,
          source: "meal_history",
        });

        tasteUpdated =
          await rebuildUserTasteEmbeddingWithFeedback(userId);
      } else {
        await ensureRecommendationFeedbackTable();

        const deletedFeedback = await prisma.$executeRaw`
          DELETE FROM recommendation_feedback
          WHERE user_id = ${userId}
            AND food_id = ${entry.food_id}
            AND source = 'meal_history'
        `;

        if (Number(deletedFeedback) > 0) {
          tasteUpdated =
            await rebuildUserTasteEmbeddingWithFeedback(userId);
        }
      }
    }

    return NextResponse.json({
      success: true,
      id: idText,
      tasteUpdated,
      message: "먹어보기 기록을 삭제했어요.",
    });
  } catch (error) {
    console.error("Meal history DELETE error:", error);

    return NextResponse.json(
      { message: "먹어보기 기록을 삭제하지 못했습니다." },
      { status: 500 }
    );
  }
}
