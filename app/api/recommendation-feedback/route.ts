import { NextRequest, NextResponse } from "next/server";

import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";
import {
  getUserRecommendationFeedback,
  rebuildUserTasteEmbeddingWithFeedback,
  upsertRecommendationFeedback,
} from "@/lib/taste-feedback";

export async function GET() {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const feedback = await getUserRecommendationFeedback(userId);

    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("Recommendation feedback GET error:", error);

    return NextResponse.json(
      { message: "추천 평가를 불러오지 못했습니다." },
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
      "recommendation-feedback-user",
      30,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as
      | {
          foodId?: unknown;
          rating?: unknown;
          source?: unknown;
        }
      | null;

    const foodIdText = String(body?.foodId ?? "").trim();

    if (!/^\d+$/.test(foodIdText)) {
      return NextResponse.json(
        { message: "잘못된 메뉴 정보입니다." },
        { status: 400 }
      );
    }

    const ratingValue = body?.rating;
    const rating: 1 | -1 | null =
      ratingValue === 1 || ratingValue === "like"
        ? 1
        : ratingValue === -1 || ratingValue === "dislike"
          ? -1
          : null;

    if (!rating) {
      return NextResponse.json(
        { message: "평가는 좋아요 또는 별로예요 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    const saved = await upsertRecommendationFeedback({
      userId,
      foodId: BigInt(foodIdText),
      rating,
      source:
        typeof body?.source === "string"
          ? body.source
          : "exploration",
    });

    if (!saved) {
      return NextResponse.json(
        { message: "평가할 메뉴를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    await rebuildUserTasteEmbeddingWithFeedback(userId);

    return NextResponse.json({
      success: true,
      foodId: foodIdText,
      rating,
      message:
        rating === 1
          ? "좋아요를 반영했습니다. 다음 추천부터 비슷한 취향을 조금 더 반영할게요."
          : "별로예요를 반영했습니다. 다음 추천에서는 비슷한 메뉴의 비중을 조금 낮출게요.",
    });
  } catch (error) {
    console.error("Recommendation feedback POST error:", error);

    return NextResponse.json(
      { message: "추천 평가를 반영하지 못했습니다." },
      { status: 500 }
    );
  }
}
