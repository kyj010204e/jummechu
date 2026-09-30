import { prisma } from "@/lib/prisma";

const LIKE_WEIGHT = 0.85;
const DISLIKE_WEIGHT = -0.65;

/*
 * 피드백은 보조 신호입니다.
 * 사용자가 여러 메뉴를 평가해도 초기/직접 선호보다 강해지지 않도록
 * 좋아요/싫어요 전체 영향량을 각각 제한합니다.
 *
 * 예:
 * 좋아요 1개  -> +0.85
 * 좋아요 2개  -> +1.70
 * 좋아요 3개+ -> 합계 최대 +2.00
 *
 * 싫어요 1개  -> -0.65
 * 싫어요 2개  -> -1.30
 * 싫어요 3개+ -> 합계 최대 -1.50
 */
const MAX_TOTAL_LIKE_WEIGHT = 2.0;
const MAX_TOTAL_DISLIKE_WEIGHT = 1.5;
const MIN_VECTOR_NORM = 1e-8;

let ensureFeedbackTablePromise: Promise<void> | null = null;

type FoodEmbeddingRow = {
  id: bigint;
  embedding_text: string;
  embedding_dim: number;
  model_name: string;
};

type PreferenceEmbeddingRow = {
  food_id: bigint;
  weight: number | string;
  embedding_text: string;
};

type FeedbackEmbeddingRow = {
  food_id: bigint;
  rating: number;
  embedding_text: string;
};

export type RecommendationFeedback = {
  foodId: string;
  rating: 1 | -1;
};

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

function centerVector(vector: number[], globalMean: number[]) {
  const normalized = normalizeVector(vector);

  if (normalized.length !== globalMean.length) {
    throw new Error("embedding 차원이 다릅니다.");
  }

  return normalizeVector(
    normalized.map((value, index) => value - globalMean[index])
  );
}

function vectorToPgArrayText(vector: number[]) {
  return (
    "{" +
    vector
      .map((value) => (Number.isFinite(value) ? String(value) : "0"))
      .join(",") +
    "}"
  );
}

export async function ensureRecommendationFeedbackTable() {
  if (!ensureFeedbackTablePromise) {
    ensureFeedbackTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS recommendation_feedback (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          food_id BIGINT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
          rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
          source TEXT NOT NULL DEFAULT 'exploration',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT recommendation_feedback_user_food_uq UNIQUE (user_id, food_id)
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS recommendation_feedback_user_idx
        ON recommendation_feedback (user_id, updated_at DESC)
      `);
    })().catch((error) => {
      ensureFeedbackTablePromise = null;
      throw error;
    });
  }

  await ensureFeedbackTablePromise;
}

export async function getUserRecommendationFeedback(
  userId: bigint
): Promise<RecommendationFeedback[]> {
  await ensureRecommendationFeedbackTable();

  const rows = await prisma.$queryRaw<
    Array<{
      food_id: bigint;
      rating: number;
    }>
  >`
    SELECT
      food_id,
      rating
    FROM recommendation_feedback
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC, id DESC
  `;

  return rows
    .filter((row) => row.rating === 1 || row.rating === -1)
    .map((row) => ({
      foodId: row.food_id.toString(),
      rating: row.rating === 1 ? 1 : -1,
    }));
}

export async function upsertRecommendationFeedback(args: {
  userId: bigint;
  foodId: bigint;
  rating: 1 | -1;
  source?: string;
}) {
  const { userId, foodId, rating } = args;
  const source = args.source?.trim().slice(0, 40) || "exploration";

  await ensureRecommendationFeedbackTable();

  const foodRows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id
    FROM foods
    WHERE id = ${foodId}
    LIMIT 1
  `;

  if (foodRows.length === 0) {
    return false;
  }

  await prisma.$executeRaw`
    INSERT INTO recommendation_feedback
    (
      user_id,
      food_id,
      rating,
      source,
      created_at,
      updated_at
    )
    VALUES
    (
      ${userId},
      ${foodId},
      ${rating},
      ${source},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id, food_id)
    DO UPDATE SET
      rating = EXCLUDED.rating,
      source = EXCLUDED.source,
      updated_at = CURRENT_TIMESTAMP
  `;

  return true;
}

/*
 * 사용자 taste embedding을 "기본 선호 + 실제 먹어본 피드백"으로 다시 계산합니다.
 *
 * - 선호 메뉴: 기존 weight 1.0 / 최애 2.0 그대로 사용
 * - 좋아요: 해당 메뉴 방향으로 +0.85
 * - 별로예요: 해당 메뉴 방향에서 -0.65
 *
 * 매 클릭마다 현재 벡터에 누적 이동시키지 않고 전체 기록으로 다시 계산하므로,
 * 같은 메뉴 평가를 바꾸더라도 드리프트가 누적되지 않습니다.
 */
export async function rebuildUserTasteEmbeddingWithFeedback(userId: bigint) {
  await ensureRecommendationFeedbackTable();

  const [allFoods, preferences, feedback] = await Promise.all([
    prisma.$queryRaw<FoodEmbeddingRow[]>`
      SELECT
        f.id,
        fe.embedding::text AS embedding_text,
        fe.embedding_dim,
        fe.model_name
      FROM foods f
      JOIN food_embeddings fe
        ON fe.food_id = f.id
      ORDER BY f.id
    `,

    prisma.$queryRaw<PreferenceEmbeddingRow[]>`
      SELECT
        ufp.food_id,
        ufp.weight,
        fe.embedding::text AS embedding_text
      FROM user_food_preferences ufp
      JOIN food_embeddings fe
        ON fe.food_id = ufp.food_id
      WHERE ufp.user_id = ${userId}
      ORDER BY ufp.id
    `,

    prisma.$queryRaw<FeedbackEmbeddingRow[]>`
      SELECT
        rf.food_id,
        rf.rating,
        fe.embedding::text AS embedding_text
      FROM recommendation_feedback rf
      JOIN food_embeddings fe
        ON fe.food_id = rf.food_id
      WHERE rf.user_id = ${userId}
      ORDER BY rf.updated_at DESC, rf.id DESC
    `,
  ]);

  if (allFoods.length === 0 || preferences.length === 0) {
    return false;
  }

  const parsedFoods = allFoods.map((row) => ({
    ...row,
    vector: parsePgVector(row.embedding_text),
  }));

  const dimension = parsedFoods[0].embedding_dim;

  if (
    parsedFoods.some(
      (food) =>
        food.embedding_dim !== dimension || food.vector.length !== dimension
    )
  ) {
    throw new Error("food embedding 차원이 일치하지 않습니다.");
  }

  const globalMean = meanVector(
    parsedFoods.map((food) => normalizeVector(food.vector))
  );

  const accumulator = new Array<number>(dimension).fill(0);

  const addVector = (vector: number[], weight: number) => {
    if (vector.length !== dimension || !Number.isFinite(weight)) {
      return;
    }

    const centered = centerVector(vector, globalMean);

    for (let i = 0; i < dimension; i += 1) {
      accumulator[i] += centered[i] * weight;
    }
  };

  const preferenceFoodIds = new Set(
    preferences.map((item) => item.food_id.toString())
  );

  for (const preference of preferences) {
    const weight = Number(preference.weight);
    addVector(
      parsePgVector(preference.embedding_text),
      Number.isFinite(weight) && weight > 0 ? weight : 1
    );
  }

  /*
   * 직접 선택된 선호 메뉴와 충돌하는 피드백은 애초에 학습 대상에서 제외합니다.
   * recommendation_feedback는 (user_id, food_id) UNIQUE이므로
   * 같은 메뉴를 좋아요 -> 싫어요로 바꿔도 두 번 누적되지 않고 최신 평가 1개만 남습니다.
   */
  const effectiveFeedback = feedback.filter(
    (item) => !preferenceFoodIds.has(item.food_id.toString())
  );

  const likeCount = effectiveFeedback.filter(
    (item) => item.rating === 1
  ).length;

  const dislikeCount = effectiveFeedback.filter(
    (item) => item.rating === -1
  ).length;

  const rawLikeWeight = likeCount * LIKE_WEIGHT;
  const rawDislikeWeight = dislikeCount * Math.abs(DISLIKE_WEIGHT);

  const likeScale =
    rawLikeWeight > 0
      ? Math.min(1, MAX_TOTAL_LIKE_WEIGHT / rawLikeWeight)
      : 1;

  const dislikeScale =
    rawDislikeWeight > 0
      ? Math.min(1, MAX_TOTAL_DISLIKE_WEIGHT / rawDislikeWeight)
      : 1;

  for (const item of effectiveFeedback) {
    const weight =
      item.rating === 1
        ? LIKE_WEIGHT * likeScale
        : DISLIKE_WEIGHT * dislikeScale;

    addVector(
      parsePgVector(item.embedding_text),
      weight
    );
  }

  /*
   * 극단적으로 좋아요/싫어요가 서로 상쇄되어 벡터가 거의 0이 되는 경우에는
   * 잘못된 0 벡터를 저장하지 않고 직접 선호만으로 한 번 더 계산합니다.
   */
  const accumulatorNorm = Math.sqrt(
    accumulator.reduce((sum, value) => sum + value * value, 0)
  );

  if (!Number.isFinite(accumulatorNorm) || accumulatorNorm < MIN_VECTOR_NORM) {
    accumulator.fill(0);

    for (const preference of preferences) {
      const weight = Number(preference.weight);
      addVector(
        parsePgVector(preference.embedding_text),
        Number.isFinite(weight) && weight > 0 ? weight : 1
      );
    }
  }

  const userTasteVector = normalizeVector(accumulator);
  const embeddingText = vectorToPgArrayText(userTasteVector);
  const modelName = parsedFoods[0].model_name;

  await prisma.$executeRaw`
    INSERT INTO user_taste_embeddings
    (
      user_id,
      embedding,
      embedding_dim,
      model_name,
      preference_count,
      created_at,
      updated_at
    )
    VALUES
    (
      ${userId},
      ${embeddingText}::double precision[],
      ${dimension},
      ${modelName},
      ${preferences.length},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      embedding = EXCLUDED.embedding,
      embedding_dim = EXCLUDED.embedding_dim,
      model_name = EXCLUDED.model_name,
      preference_count = EXCLUDED.preference_count,
      updated_at = CURRENT_TIMESTAMP
  `;

  return true;
}
