import { NextResponse } from "next/server";

import { getUserId } from "@/lib/session";
import {
  buildPairRecommendationContext,
  PairRecommendationError,
} from "@/lib/pair-recommendation";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      sessionId: string;
    }>;
  }
) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const { sessionId: sessionIdText } = await params;

    if (!/^\d+$/.test(sessionIdText)) {
      return NextResponse.json(
        { message: "잘못된 추천 세션입니다." },
        { status: 400 }
      );
    }

    const result = await buildPairRecommendationContext(
      BigInt(sessionIdText),
      userId
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PairRecommendationError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status }
      );
    }

    console.error(
      "Friend recommendation session GET error:",
      error
    );

    return NextResponse.json(
      { message: "공통메뉴 추천을 만들지 못했습니다." },
      { status: 500 }
    );
  }
}
