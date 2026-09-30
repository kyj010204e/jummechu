import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";
import { getUserRecommendationFeedback } from "@/lib/taste-feedback";

const PROFILE_WEIGHT = 0.6;
const BEST_ANCHOR_WEIGHT = 0.3;
const MEAN_ANCHOR_WEIGHT = 0.1;

const ABSOLUTE_MIN_SCORE = 0.3;
const RELATIVE_MIN_RATIO = 0.5;
const MAX_RESULTS = 24;

type RawTasteRow = {
  embedding_text: string;
};

type RawFoodRow = {
  id: bigint;
  name: string;
  cuisine_type: string | null;
  food_type: string | null;
  embedding_text: string;
};

type RawPreferenceRow = {
  id: bigint;
  name: string;
  cuisine_type: string | null;
  food_type: string | null;
  weight: number | string;
  embedding_text: string;
};

type FoodVector = {
  id: string;
  name: string;
  cuisineType: string | null;
  foodType: string | null;
  family: string;
  vector: number[];
};

type PreferenceVector = FoodVector & {
  weight: number;
};

type Candidate = FoodVector & {
  fitScore: number;
  fitScore01: number;
  noveltyScore: number;
  explorationScore: number;
  bestAnchor: string | null;
  reason: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parsePgVector(value: string) {
  const text = value.trim();

  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new Error("잘못된 embedding 형식입니다.");
  }

  const body = text.slice(1, -1);
  if (!body) return [];

  return body.split(",").map((item) => Number(item));
}

function normalizeVector(vector: number[]) {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  const norm = Math.sqrt(sum);

  if (!Number.isFinite(norm) || norm === 0) {
    return [...vector];
  }

  return vector.map((value) => value / norm);
}

function meanVector(vectors: number[][]) {
  if (vectors.length === 0) return [];

  const dimension = vectors[0].length;
  const result = new Array<number>(dimension).fill(0);

  for (const vector of vectors) {
    if (vector.length !== dimension) {
      throw new Error("embedding 차원이 다릅니다.");
    }

    for (let i = 0; i < dimension; i += 1) {
      result[i] += vector[i];
    }
  }

  for (let i = 0; i < dimension; i += 1) {
    result[i] /= vectors.length;
  }

  return result;
}

function weightedMeanVector(
  items: Array<{ vector: number[]; weight: number }>
) {
  if (items.length === 0) return [];

  const dimension = items[0].vector.length;
  const result = new Array<number>(dimension).fill(0);
  let totalWeight = 0;

  for (const item of items) {
    if (item.vector.length !== dimension) {
      throw new Error("embedding 차원이 다릅니다.");
    }

    const weight = Math.max(0.1, item.weight);
    totalWeight += weight;

    for (let i = 0; i < dimension; i += 1) {
      result[i] += item.vector[i] * weight;
    }
  }

  if (totalWeight <= 0) return normalizeVector(result);

  return normalizeVector(
    result.map((value) => value / totalWeight)
  );
}

function centerVector(vector: number[], globalMean: number[]) {
  const normalized = normalizeVector(vector);

  if (normalized.length !== globalMean.length) {
    throw new Error("embedding 차원이 다릅니다.");
  }

  return normalizeVector(
    normalized.map((value, index) => value - globalMean[index])
  );
}

function dotProduct(a: number[], b: number[]) {
  if (a.length !== b.length) return -1;

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }

  return sum;
}

function getFoodFamily(name: string, foodType: string | null) {
  const normalized = name.replace(/\s+/g, "");

  if (normalized.includes("김밥")) return "김밥";
  if (normalized.includes("볶음밥")) return "볶음밥";
  if (normalized.includes("비빔밥")) return "비빔밥";
  if (normalized.includes("덮밥")) return "덮밥";
  if (normalized.includes("국밥")) return "국밥";
  if (normalized.includes("라면") || normalized.includes("라멘")) return "라면";
  if (normalized.includes("우동")) return "우동";
  if (normalized.includes("냉면")) return "냉면";
  if (normalized.includes("칼국수")) return "칼국수";
  if (
    normalized.includes("국수") ||
    normalized.includes("쫄면") ||
    normalized.includes("짬뽕") ||
    normalized.includes("짜장") ||
    normalized.includes("자장")
  ) {
    return "면류";
  }
  if (normalized.includes("치킨") || normalized.includes("닭튀김")) return "치킨";
  if (normalized.includes("돈가스") || normalized.includes("돈까스") || normalized.includes("돈카츠")) return "돈가스";
  if (normalized.includes("버거")) return "버거";
  if (normalized.includes("피자")) return "피자";
  if (normalized.includes("초밥") || normalized.includes("스시")) return "초밥";
  if (normalized.includes("찌개")) return "찌개";
  if (normalized.includes("전골")) return "전골";
  if (normalized.includes("국")) return "국";
  if (normalized.includes("탕")) return "탕";
  if (normalized.includes("구이")) return "구이";
  if (normalized.includes("튀김")) return "튀김";
  if (normalized.includes("볶음")) return "볶음";
  if (normalized.includes("조림")) return "조림";
  if (normalized.includes("찜")) return "찜";
  if (normalized.includes("전")) return "전";
  if (normalized.includes("무침")) return "무침";
  if (normalized.includes("죽")) return "죽";
  if (normalized.includes("떡")) return "떡";

  return foodType || "기타";
}

function addWeight(map: Map<string, number>, key: string | null, weight: number) {
  const normalized = key?.trim();
  if (!normalized) return;

  map.set(normalized, (map.get(normalized) ?? 0) + Math.max(0.1, weight));
}

function getTopKey(map: Map<string, number>) {
  let best: string | null = null;
  let bestWeight = Number.NEGATIVE_INFINITY;

  for (const [key, value] of map) {
    if (value > bestWeight) {
      best = key;
      bestWeight = value;
    }
  }

  return best;
}

function buildReason(args: {
  dominantCuisine: string | null;
  selectedCuisines: Set<string>;
  selectedFamilies: Set<string>;
  candidate: Candidate;
}) {
  const {
    dominantCuisine,
    selectedCuisines,
    selectedFamilies,
    candidate,
  } = args;

  if (
    dominantCuisine &&
    candidate.cuisineType &&
    candidate.cuisineType !== dominantCuisine
  ) {
    return `${dominantCuisine} 취향과 비슷한 결은 유지하면서 ${candidate.cuisineType} 메뉴로 살짝 넓혀봤어요. 한번 도전해보세요!`;
  }

  if (
    candidate.cuisineType &&
    !selectedCuisines.has(candidate.cuisineType)
  ) {
    return `평소 취향과는 잘 맞지만 자주 고르지 않았던 ${candidate.cuisineType} 메뉴예요. 한번 도전해보세요!`;
  }

  if (!selectedFamilies.has(candidate.family)) {
    return `평소 좋아하는 메뉴와 취향은 비슷하지만 자주 고르지 않은 ${candidate.family} 계열이에요. 한번 도전해보세요!`;
  }

  if (candidate.bestAnchor) {
    return `${candidate.bestAnchor} 취향과 비슷한 새로운 선택이에요. 익숙한 취향에서 한 걸음만 넓혀봤어요!`;
  }

  return "평소 취향과 비슷하면서도 조금 새로운 메뉴예요. 한번 도전해보세요!";
}

export async function GET(request: Request) {
  try {
    const userId = await getUserId();

    const { searchParams } = new URL(request.url);
    const variantRaw = Number(searchParams.get("variant") ?? "0");
    const variant = Number.isFinite(variantRaw)
      ? Math.max(0, Math.floor(variantRaw))
      : 0;

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const limited = rateLimit(
      "exploration-user",
      20,
      60_000,
      userId.toString()
    );

    if (limited) return limited;

    const feedback =
      await getUserRecommendationFeedback(
        userId
      );

    const ratedFoodIds =
      new Set(
        feedback.map(
          (item) => item.foodId
        )
      );

    const [tasteRows, rawFoods, rawPreferences] = await Promise.all([
      prisma.$queryRaw<RawTasteRow[]>`
        SELECT embedding::text AS embedding_text
        FROM user_taste_embeddings
        WHERE user_id = ${userId}
        LIMIT 1
      `,

      prisma.$queryRaw<RawFoodRow[]>`
        SELECT
          f.id,
          f.name,
          f.cuisine_type,
          f.food_type,
          fe.embedding::text AS embedding_text
        FROM foods f
        JOIN food_embeddings fe
          ON fe.food_id = f.id
        ORDER BY f.id
      `,

      prisma.$queryRaw<RawPreferenceRow[]>`
        SELECT
          f.id,
          f.name,
          f.cuisine_type,
          f.food_type,
          ufp.weight,
          fe.embedding::text AS embedding_text
        FROM user_food_preferences ufp
        JOIN foods f
          ON f.id = ufp.food_id
        JOIN food_embeddings fe
          ON fe.food_id = f.id
        WHERE ufp.user_id = ${userId}
        ORDER BY ufp.weight DESC, ufp.id
      `,
    ]);

    if (rawFoods.length === 0 || rawPreferences.length === 0) {
      return NextResponse.json({
        explorationMenus: [],
        message: "선호 메뉴를 먼저 등록하면 취향 탐험을 사용할 수 있어요.",
      });
    }

    const rawNormalizedVectors = rawFoods.map((food) =>
      normalizeVector(parsePgVector(food.embedding_text))
    );

    const globalMean = meanVector(rawNormalizedVectors);

    const foods: FoodVector[] = rawFoods.map((food) => ({
      id: food.id.toString(),
      name: food.name,
      cuisineType: food.cuisine_type,
      foodType: food.food_type,
      family: getFoodFamily(food.name, food.food_type),
      vector: centerVector(parsePgVector(food.embedding_text), globalMean),
    }));

    const preferences: PreferenceVector[] = rawPreferences.map((food) => ({
      id: food.id.toString(),
      name: food.name,
      cuisineType: food.cuisine_type,
      foodType: food.food_type,
      family: getFoodFamily(food.name, food.food_type),
      weight: Number(food.weight),
      vector: centerVector(parsePgVector(food.embedding_text), globalMean),
    }));

    const selectedIds = new Set(preferences.map((item) => item.id));

    const cuisineWeights = new Map<string, number>();
    const familyWeights = new Map<string, number>();

    for (const preference of preferences) {
      addWeight(cuisineWeights, preference.cuisineType, preference.weight);
      addWeight(familyWeights, preference.family, preference.weight);
    }

    const selectedCuisines = new Set(cuisineWeights.keys());
    const selectedFamilies = new Set(familyWeights.keys());
    const dominantCuisine = getTopKey(cuisineWeights);

    let userVector: number[] = [];

    if (tasteRows[0]?.embedding_text) {
      userVector = normalizeVector(parsePgVector(tasteRows[0].embedding_text));
    }

    if (
      userVector.length === 0 ||
      userVector.length !== preferences[0].vector.length
    ) {
      userVector = weightedMeanVector(
        preferences.map((item) => ({
          vector: item.vector,
          weight: item.weight,
        }))
      );
    }

    const rawCandidates: Candidate[] = [];

    for (const food of foods) {
      /*
       * 이미 기본 선호로 등록했거나 실제로 먹어보고 평가한 메뉴는
       * 더 이상 "새로운 탐험"으로 반복 노출하지 않습니다.
       */
      if (
        selectedIds.has(food.id) ||
        ratedFoodIds.has(food.id)
      ) {
        continue;
      }

      const profileSimilarity = dotProduct(userVector, food.vector);
      const anchorScores = preferences.map((preference) => ({
        name: preference.name,
        similarity: dotProduct(preference.vector, food.vector),
      }));

      const sortedAnchors = [...anchorScores].sort(
        (a, b) => b.similarity - a.similarity
      );

      const bestAnchor = sortedAnchors[0]?.name ?? null;
      const bestAnchorSimilarity = sortedAnchors[0]?.similarity ?? profileSimilarity;
      const meanAnchorSimilarity =
        anchorScores.length > 0
          ? anchorScores.reduce((sum, item) => sum + item.similarity, 0) /
            anchorScores.length
          : profileSimilarity;

      const fitScore =
        PROFILE_WEIGHT * profileSimilarity +
        BEST_ANCHOR_WEIGHT * bestAnchorSimilarity +
        MEAN_ANCHOR_WEIGHT * meanAnchorSimilarity;

      const cuisineNovelty = food.cuisineType
        ? selectedCuisines.has(food.cuisineType)
          ? 0
          : 1
        : 0.25;

      const familyNovelty = selectedFamilies.has(food.family) ? 0 : 1;

      /*
       * 사용자가 처음 제안한 아이디어처럼
       * 맛/취향의 큰 틀은 유지하고, 요리권(cuisine)을 가장 적극적으로
       * 바꾸며 family는 보조적으로 다양화합니다.
       */
      const noveltyScore =
        clamp(cuisineNovelty * 0.7 + familyNovelty * 0.3, 0, 1);

      const fitScore01 = clamp((fitScore + 1) / 2, 0, 1);
      const explorationScore =
        fitScore01 * 0.82 + noveltyScore * 0.18;

      rawCandidates.push({
        ...food,
        fitScore,
        fitScore01,
        noveltyScore,
        explorationScore,
        bestAnchor,
        reason: "",
      });
    }

    rawCandidates.sort((a, b) => b.fitScore - a.fitScore);

    if (rawCandidates.length === 0) {
      return NextResponse.json({ explorationMenus: [] });
    }

    const bestFit = rawCandidates[0].fitScore;
    const minimumFit = Math.min(
      bestFit,
      Math.max(ABSOLUTE_MIN_SCORE, bestFit * RELATIVE_MIN_RATIO)
    );

    const candidates = rawCandidates
      .filter(
        (candidate) =>
          candidate.fitScore >= minimumFit &&
          candidate.noveltyScore >= 0.3
      )
      .map((candidate) => ({
        ...candidate,
        reason: buildReason({
          dominantCuisine,
          selectedCuisines,
          selectedFamilies,
          candidate,
        }),
      }))
      .sort((a, b) => b.explorationScore - a.explorationScore);

    const selected: Candidate[] = [];
    const usedFamilies = new Set<string>();
    const usedCuisines = new Set<string>();

    /*
     * 같은 위치에서 "다른 탐험 메뉴 보기"를 눌렀을 때
     * 항상 똑같은 1~2개만 나오지 않도록 상위 후보 풀을 회전합니다.
     * 랜덤값 대신 variant를 써서 요청 하나는 재현 가능하게 유지합니다.
     */
    const rotationPool = candidates.slice(0, Math.min(24, candidates.length));
    const offset = rotationPool.length > 0
      ? (variant * 2) % rotationPool.length
      : 0;
    const rotatedCandidates = [
      ...rotationPool.slice(offset),
      ...rotationPool.slice(0, offset),
      ...candidates.slice(rotationPool.length),
    ];

    for (const candidate of rotatedCandidates) {
      if (
        selected.length > 0 &&
        usedFamilies.has(candidate.family) &&
        candidate.cuisineType &&
        usedCuisines.has(candidate.cuisineType)
      ) {
        continue;
      }

      selected.push(candidate);
      usedFamilies.add(candidate.family);
      if (candidate.cuisineType) usedCuisines.add(candidate.cuisineType);

      if (selected.length >= MAX_RESULTS) break;
    }

    if (selected.length < MAX_RESULTS) {
      for (const candidate of rotatedCandidates) {
        if (selected.some((item) => item.id === candidate.id)) continue;
        selected.push(candidate);
        if (selected.length >= MAX_RESULTS) break;
      }
    }

    return NextResponse.json({
      dominantCuisine,
      explorationMenus: selected.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        cuisineType: candidate.cuisineType,
        foodType: candidate.foodType,
        family: candidate.family,
        compatibilityScore: Math.round(candidate.fitScore01 * 100),
        noveltyScore: Math.round(candidate.noveltyScore * 100),
        explorationScore: Math.round(candidate.explorationScore * 100),
        anchor: candidate.bestAnchor,
        reason: candidate.reason,
        isExploration: true,
      })),
    });
  } catch (error) {
    console.error("Exploration recommendation error:", error);

    return NextResponse.json(
      { message: "취향 탐험 메뉴를 만들지 못했습니다." },
      { status: 500 }
    );
  }
}
