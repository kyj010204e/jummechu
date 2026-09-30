import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";

const PROFILE_WEIGHT = 0.60;
const BEST_ANCHOR_WEIGHT = 0.30;
const MEAN_ANCHOR_WEIGHT = 0.10;

const PAIR_FAIRNESS_WEIGHT = 0.60;
const PAIR_AVERAGE_WEIGHT = 0.40;

const MMR_LAMBDA = 0.70;
const MAX_PER_FAMILY = 2;
const CANDIDATE_POOL_SIZE = 100;
const RECOMMEND_TOP_K = 12;
const ABSOLUTE_MIN_SCORE = 0.30;
const RELATIVE_MIN_RATIO = 0.50;

type SessionRow = {
  id: bigint;
  requester_id: bigint;
  friend_id: bigint;
  status: string;
};

type UserRow = {
  id: bigint;
  name: string;
  email: string;
};

type PreferenceRow = {
  user_id: bigint;
  food_id: bigint;
  name: string;
  weight: number;
};

type TasteRow = {
  user_id: bigint;
  embedding_text: string;
  embedding_dim: number;
};

type FoodEmbeddingRow = {
  id: bigint;
  name: string;
  cuisine_type: string | null;
  food_type: string | null;
  embedding_text: string;
};

type ParsedFood = {
  id: string;
  name: string;
  cuisineType: string | null;
  foodType: string | null;
  vector: number[];
};

type Anchor = {
  id: string;
  name: string;
  weight: number;
  vector: number[];
};

type UserMenuScore = {
  total: number;
  profileSimilarity: number;
  bestAnchorSimilarity: number;
  meanAnchorSimilarity: number;
};

type Candidate = {
  id: string;
  name: string;
  cuisineType: string | null;
  foodType: string | null;
  family: string;
  vector: number[];
  rawScore: number;
  userAScore: number;
  userBScore: number;
  exactCommon: boolean;
  bothFavorite: boolean;
  mmrScore?: number;
};

function parsePgVector(value: string) {
  const text = value.trim();

  if (!text.startsWith("{") || !text.endsWith("}")) {
    throw new Error("잘못된 embedding 형식입니다.");
  }

  const body = text.slice(1, -1);
  if (!body) return [];

  const vector = body.split(",").map((item) => Number(item));

  if (vector.some((item) => !Number.isFinite(item))) {
    throw new Error("embedding에 숫자가 아닌 값이 있습니다.");
  }

  return vector;
}

function normalizeVector(vector: number[]) {
  let sum = 0;
  for (const value of vector) sum += value * value;

  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return [...vector];

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

    for (let i = 0; i < dimension; i++) {
      result[i] += vector[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    result[i] /= vectors.length;
  }

  return result;
}

function centerVector(vector: number[], globalMean: number[]) {
  const normalized = normalizeVector(vector);

  if (normalized.length !== globalMean.length) {
    throw new Error("embedding 중심 보정 차원이 다릅니다.");
  }

  return normalizeVector(
    normalized.map((value, index) => value - globalMean[index])
  );
}

function dotProduct(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;

  let result = 0;
  for (let i = 0; i < a.length; i++) result += a[i] * b[i];
  return result;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getFoodFamily(name: string, foodType: string | null) {
  if (name.includes("김밥")) return "김밥";
  if (name.includes("볶음밥")) return "볶음밥";
  if (name.includes("비빔밥")) return "비빔밥";
  if (name.includes("덮밥")) return "덮밥";
  if (name.includes("초밥") || name.includes("스시")) return "초밥";
  if (name.includes("국밥")) return "국밥";
  if (name.includes("라면") || name.includes("라멘")) return "라면";
  if (name.includes("냉면")) return "냉면";
  if (name.includes("우동")) return "우동";
  if (name.includes("칼국수")) return "칼국수";
  if (
    name.includes("국수") ||
    name.includes("쫄면") ||
    name.includes("짬뽕") ||
    name.includes("자장") ||
    name.includes("짜장")
  ) {
    return "면류";
  }
  if (name.includes("치킨") || name.includes("닭튀김")) return "치킨";
  if (name.includes("돈가스") || name.includes("돈까스") || name.includes("돈카츠")) {
    return "돈가스";
  }
  if (name.includes("버거") || name.includes("햄버거")) return "버거";
  if (name.includes("피자")) return "피자";
  if (name.includes("찌개")) return "찌개";
  if (name.includes("전골")) return "전골";
  if (name.includes("탕")) return "탕";
  if (name.includes("구이")) return "구이";
  if (name.includes("튀김")) return "튀김";
  if (name.includes("볶음")) return "볶음";
  if (name.includes("조림")) return "조림";
  if (name.includes("찜")) return "찜";
  if (name.includes("죽")) return "죽";

  return foodType || "기타";
}

function buildAnchors(
  preferences: PreferenceRow[],
  userId: bigint,
  foodsById: Map<string, ParsedFood>,
  globalMean: number[]
) {
  const anchors: Anchor[] = [];

  for (const preference of preferences) {
    if (preference.user_id !== userId) continue;

    const id = preference.food_id.toString();
    const food = foodsById.get(id);
    if (!food) continue;

    anchors.push({
      id,
      name: preference.name,
      weight: Number(preference.weight),
      vector: centerVector(food.vector, globalMean),
    });
  }

  return anchors;
}

function scoreForUser(
  userVector: number[],
  foodVector: number[],
  anchors: Anchor[]
): UserMenuScore {
  const profileSimilarity = dotProduct(userVector, foodVector);

  let bestAnchorSimilarity = profileSimilarity;
  let meanAnchorSimilarity = profileSimilarity;

  if (anchors.length > 0) {
    const anchorScores = anchors.map((anchor) => {
      const favoriteBoost = anchor.weight >= 2 ? 1.05 : 1;
      return dotProduct(anchor.vector, foodVector) * favoriteBoost;
    });

    bestAnchorSimilarity = Math.max(...anchorScores);
    meanAnchorSimilarity =
      anchorScores.reduce((sum, score) => sum + score, 0) /
      anchorScores.length;
  }

  const total =
    PROFILE_WEIGHT * profileSimilarity +
    BEST_ANCHOR_WEIGHT * bestAnchorSimilarity +
    MEAN_ANCHOR_WEIGHT * meanAnchorSimilarity;

  return {
    total,
    profileSimilarity,
    bestAnchorSimilarity,
    meanAnchorSimilarity,
  };
}

function rerankWithMmr(candidates: Candidate[], topK: number) {
  let remaining = [...candidates];
  const selected: Candidate[] = [];
  const familyCounts = new Map<string, number>();

  while (remaining.length > 0 && selected.length < topK) {
    let best: Candidate | null = null;
    let bestMmr = Number.NEGATIVE_INFINITY;

    for (const candidate of remaining) {
      const familyCount = familyCounts.get(candidate.family) ?? 0;
      if (familyCount >= MAX_PER_FAMILY) continue;

      let redundancy = 0;
      if (selected.length > 0) {
        redundancy = Math.max(
          ...selected.map((item) => dotProduct(candidate.vector, item.vector))
        );
      }

      const mmrScore =
        MMR_LAMBDA * candidate.rawScore -
        (1 - MMR_LAMBDA) * redundancy;

      if (mmrScore > bestMmr) {
        best = candidate;
        bestMmr = mmrScore;
      }
    }

    if (!best) break;

    const picked = { ...best, mmrScore: bestMmr };
    selected.push(picked);
    familyCounts.set(picked.family, (familyCounts.get(picked.family) ?? 0) + 1);

    remaining = remaining.filter((item) => item.id !== picked.id);
  }

  if (selected.length < topK) {
    const selectedIds = new Set(selected.map((item) => item.id));

    for (const candidate of candidates) {
      if (selectedIds.has(candidate.id)) continue;
      selected.push({ ...candidate, mmrScore: candidate.rawScore });
      if (selected.length >= topK) break;
    }
  }

  return selected;
}

function fallbackRecommendations(
  preferences: PreferenceRow[],
  userAId: bigint,
  userBId: bigint
) {
  const byFood = new Map<
    string,
    { id: string; name: string; aWeight: number; bWeight: number }
  >();

  for (const row of preferences) {
    const key = row.food_id.toString();
    const current = byFood.get(key) ?? {
      id: key,
      name: row.name,
      aWeight: 0,
      bWeight: 0,
    };

    if (row.user_id === userAId) current.aWeight = Number(row.weight);
    if (row.user_id === userBId) current.bWeight = Number(row.weight);

    byFood.set(key, current);
  }

  return Array.from(byFood.values())
    .map((item) => {
      const exactCommon = item.aWeight > 0 && item.bWeight > 0;
      const bothFavorite = item.aWeight >= 2 && item.bWeight >= 2;

      return {
        id: item.id,
        name: item.name,
        cuisineType: null,
        foodType: null,
        score: bothFavorite ? 100 : exactCommon ? 94 : 70,
        userAScore: item.aWeight > 0 ? 100 : 0,
        userBScore: item.bWeight > 0 ? 100 : 0,
        exactCommon,
        bothFavorite,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, RECOMMEND_TOP_K);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
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

    const sessionRows = await prisma.$queryRaw<SessionRow[]>`
      SELECT id, requester_id, friend_id, status
      FROM friend_recommendation_sessions
      WHERE id = ${BigInt(sessionIdText)}
      LIMIT 1
    `;

    const session = sessionRows[0];

    if (!session) {
      return NextResponse.json(
        { message: "존재하지 않는 추천 세션입니다." },
        { status: 404 }
      );
    }

    if (session.requester_id !== userId && session.friend_id !== userId) {
      return NextResponse.json(
        { message: "이 추천 세션에 접근할 수 없습니다." },
        { status: 403 }
      );
    }

    if (
      session.status !== "ACCEPTED" &&
      session.status !== "COMPLETED"
    ) {
      return NextResponse.json(
        {
          message: "수락되었거나 완료된 추천 세션만 사용할 수 있습니다.",
          status: session.status,
        },
        { status: 409 }
      );
    }

    const userAId = session.requester_id;
    const userBId = session.friend_id;

    const [users, preferences, tasteRows] = await Promise.all([
      prisma.$queryRaw<UserRow[]>`
        SELECT id, name, email
        FROM users
        WHERE id IN (${userAId}, ${userBId})
      `,

      prisma.$queryRaw<PreferenceRow[]>`
        SELECT
          ufp.user_id,
          f.id AS food_id,
          f.name,
          ufp.weight
        FROM user_food_preferences ufp
        JOIN foods f ON f.id = ufp.food_id
        WHERE ufp.user_id IN (${userAId}, ${userBId})
        ORDER BY ufp.user_id, ufp.weight DESC, f.name ASC
      `,

      prisma.$queryRaw<TasteRow[]>`
        SELECT
          user_id,
          embedding::text AS embedding_text,
          embedding_dim
        FROM user_taste_embeddings
        WHERE user_id IN (${userAId}, ${userBId})
      `,
    ]);

    const userAMap = new Map<string, number>(
      preferences
        .filter((item) => item.user_id === userAId)
        .map((item) => [item.food_id.toString(), Number(item.weight)])
    );

    const userBMap = new Map<string, number>(
      preferences
        .filter((item) => item.user_id === userBId)
        .map((item) => [item.food_id.toString(), Number(item.weight)])
    );

    let recommendations: Array<{
      id: string;
      name: string;
      cuisineType: string | null;
      foodType: string | null;
      score: number;
      userAScore: number;
      userBScore: number;
      exactCommon: boolean;
      bothFavorite: boolean;
    }> = [];

    const tasteA = tasteRows.find((row) => row.user_id === userAId);
    const tasteB = tasteRows.find((row) => row.user_id === userBId);

    if (tasteA && tasteB) {
      const rawFoods = await prisma.$queryRaw<FoodEmbeddingRow[]>`
        SELECT
          f.id,
          f.name,
          f.cuisine_type,
          f.food_type,
          fe.embedding::text AS embedding_text
        FROM foods f
        JOIN food_embeddings fe ON fe.food_id = f.id
        ORDER BY f.id
      `;

      const foods: ParsedFood[] = rawFoods.map((row) => ({
        id: row.id.toString(),
        name: row.name,
        cuisineType: row.cuisine_type,
        foodType: row.food_type,
        vector: parsePgVector(row.embedding_text),
      }));

      if (foods.length > 0) {
        const globalMean = meanVector(
          foods.map((food) => normalizeVector(food.vector))
        );

        const vectorA = normalizeVector(parsePgVector(tasteA.embedding_text));
        const vectorB = normalizeVector(parsePgVector(tasteB.embedding_text));

        if (
          vectorA.length !== tasteA.embedding_dim ||
          vectorB.length !== tasteB.embedding_dim ||
          vectorA.length !== vectorB.length
        ) {
          throw new Error("두 사용자의 embedding 차원이 올바르지 않습니다.");
        }

        const foodsById = new Map<string, ParsedFood>(
          foods.map((food): [string, ParsedFood] => [food.id, food])
        );
        const anchorsA = buildAnchors(preferences, userAId, foodsById, globalMean);
        const anchorsB = buildAnchors(preferences, userBId, foodsById, globalMean);

        const candidates: Candidate[] = foods.map((food) => {
          const centeredFood = centerVector(food.vector, globalMean);

          const a = scoreForUser(vectorA, centeredFood, anchorsA);
          const b = scoreForUser(vectorB, centeredFood, anchorsB);

          const average = (a.total + b.total) / 2;
          const fairness = Math.min(a.total, b.total);

          const aWeight = userAMap.get(food.id) ?? 0;
          const bWeight = userBMap.get(food.id) ?? 0;

          const exactCommon = aWeight > 0 && bWeight > 0;
          const bothFavorite = aWeight >= 2 && bWeight >= 2;

          let bonus = 0;
          if (exactCommon) bonus += 0.055;
          else if (aWeight > 0 || bWeight > 0) bonus += 0.018;
          if (bothFavorite) bonus += 0.030;

          return {
            id: food.id,
            name: food.name,
            cuisineType: food.cuisineType,
            foodType: food.foodType,
            family: getFoodFamily(food.name, food.foodType),
            vector: centeredFood,
            rawScore:
              PAIR_FAIRNESS_WEIGHT * fairness +
              PAIR_AVERAGE_WEIGHT * average +
              bonus,
            userAScore: a.total,
            userBScore: b.total,
            exactCommon,
            bothFavorite,
          };
        });

        candidates.sort((a, b) => b.rawScore - a.rawScore);

        if (candidates.length > 0) {
          const bestScore = candidates[0].rawScore;
          const desiredMinScore = Math.max(
            ABSOLUTE_MIN_SCORE,
            bestScore * RELATIVE_MIN_RATIO
          );
          const minScore = Math.min(bestScore, desiredMinScore);

          const candidatePool = candidates
            .filter((candidate) => candidate.rawScore >= minScore)
            .slice(0, CANDIDATE_POOL_SIZE);

          const selected = rerankWithMmr(candidatePool, RECOMMEND_TOP_K);

          recommendations = selected.map((item) => ({
            id: item.id,
            name: item.name,
            cuisineType: item.cuisineType,
            foodType: item.foodType,
            score: clamp(Math.round((item.rawScore + 1) * 50), 0, 100),
            userAScore: clamp(Math.round((item.userAScore + 1) * 50), 0, 100),
            userBScore: clamp(Math.round((item.userBScore + 1) * 50), 0, 100),
            exactCommon: item.exactCommon,
            bothFavorite: item.bothFavorite,
          }));
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations = fallbackRecommendations(preferences, userAId, userBId);
    }

    const userA = users.find((user) => user.id === userAId);
    const userB = users.find((user) => user.id === userBId);

    const currentIsA = userId === userAId;
    const me = currentIsA ? userA : userB;
    const friend = currentIsA ? userB : userA;
    const myId = currentIsA ? userAId : userBId;
    const friendId = currentIsA ? userBId : userAId;

    const serializePreferences = (targetId: bigint) =>
      preferences
        .filter((item) => item.user_id === targetId)
        .map((item) => ({
          id: item.food_id.toString(),
          name: item.name,
          weight: Number(item.weight),
          favorite: Number(item.weight) >= 2,
        }));

    const myPreferenceIds = new Set(
      preferences
        .filter((item) => item.user_id === myId)
        .map((item) => item.food_id.toString())
    );

    const commonPreferences = preferences
      .filter(
        (item) =>
          item.user_id === friendId &&
          myPreferenceIds.has(item.food_id.toString())
      )
      .map((item) => ({
        id: item.food_id.toString(),
        name: item.name,
      }));

    return NextResponse.json({
      session: {
        id: session.id.toString(),
        status: session.status,
      },
      recommendationMode: tasteA && tasteB ? "embedding" : "fallback",
      me: {
        id: me?.id.toString() ?? userId.toString(),
        name: me?.name ?? "나",
        email: me?.email ?? "",
      },
      friend: {
        id: friend?.id.toString() ?? friendId.toString(),
        name: friend?.name ?? "친구",
        email: friend?.email ?? "",
      },
      myPreferences: serializePreferences(myId),
      friendPreferences: serializePreferences(friendId),
      commonPreferences,
      recommendations,
    });
  } catch (error) {
    console.error("Friend recommendation session GET error:", error);

    return NextResponse.json(
      { message: "공통메뉴 추천을 만들지 못했습니다." },
      { status: 500 }
    );
  }
}
