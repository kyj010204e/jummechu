import { prisma } from "@/lib/prisma";

let ensureMealHistoryTablePromise: Promise<void> | null = null;

export type MealHistorySource = "recommendation" | "exploration";

export type MealHistoryEntry = {
  id: string;
  restaurantKey: string;
  restaurantName: string;
  roadAddress: string;
  address: string;
  foodId: string | null;
  menuName: string | null;
  source: MealHistorySource;
  rating: 1 | -1 | null;
  privateComment: string;
  triedAt: string;
  ratedAt: string | null;
};

function normalizeSource(value: unknown): MealHistorySource {
  return value === "exploration" ? "exploration" : "recommendation";
}

export function cleanMealHistoryText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeMealHistoryRating(value: unknown): 1 | -1 | null {
  if (value === 1 || value === "like") return 1;
  if (value === -1 || value === "dislike") return -1;
  return null;
}

export async function ensureMealHistoryTable() {
  if (!ensureMealHistoryTablePromise) {
    ensureMealHistoryTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS meal_history (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_attempt_id TEXT NOT NULL,
          restaurant_key TEXT NOT NULL,
          restaurant_name TEXT NOT NULL,
          road_address TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          food_id BIGINT REFERENCES foods(id) ON DELETE SET NULL,
          menu_name TEXT,
          source TEXT NOT NULL DEFAULT 'recommendation',
          rating SMALLINT CHECK (rating IN (-1, 1)),
          private_comment TEXT NOT NULL DEFAULT '',
          tried_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          rated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      /*
       * 기존 운영 DB에 meal_history가 이미 있어도 안전하게 확장합니다.
       * private_comment는 현재 사용자 본인만 조회/수정할 수 있는 개인 메모입니다.
       */
      await prisma.$executeRawUnsafe(`
        ALTER TABLE meal_history
        ADD COLUMN IF NOT EXISTS private_comment TEXT NOT NULL DEFAULT ''
      `);

      await prisma.$executeRawUnsafe(`
        ALTER TABLE meal_history
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS meal_history_user_attempt_uq
        ON meal_history (user_id, client_attempt_id)
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS meal_history_user_tried_idx
        ON meal_history (user_id, tried_at DESC)
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS meal_history_user_restaurant_idx
        ON meal_history (user_id, restaurant_key, tried_at DESC)
      `);
    })().catch((error) => {
      ensureMealHistoryTablePromise = null;
      throw error;
    });
  }

  await ensureMealHistoryTablePromise;
}

export async function resolveFoodForMeal(args: {
  foodId?: unknown;
  menuName?: unknown;
}) {
  const foodIdText = cleanMealHistoryText(args.foodId, 40);
  const menuName = cleanMealHistoryText(args.menuName, 120);

  if (/^\d+$/.test(foodIdText)) {
    const rows = await prisma.$queryRaw<
      Array<{ id: bigint; name: string }>
    >`
      SELECT id, name
      FROM foods
      WHERE id = ${BigInt(foodIdText)}
      LIMIT 1
    `;

    if (rows[0]) {
      return {
        foodId: rows[0].id,
        menuName: menuName || rows[0].name,
      };
    }
  }

  if (menuName) {
    const rows = await prisma.$queryRaw<
      Array<{ id: bigint; name: string }>
    >`
      SELECT id, name
      FROM foods
      WHERE name = ${menuName}
      ORDER BY id
      LIMIT 1
    `;

    if (rows[0]) {
      return {
        foodId: rows[0].id,
        menuName: rows[0].name,
      };
    }
  }

  return {
    foodId: null as bigint | null,
    menuName: menuName || null,
  };
}

export async function createMealHistoryEntry(args: {
  userId: bigint;
  clientAttemptId: unknown;
  restaurantKey: unknown;
  restaurantName: unknown;
  roadAddress?: unknown;
  address?: unknown;
  foodId?: unknown;
  menuName?: unknown;
  source?: unknown;
  rating?: unknown;
  privateComment?: unknown;
}) {
  await ensureMealHistoryTable();

  const clientAttemptId = cleanMealHistoryText(args.clientAttemptId, 100);
  const restaurantKey = cleanMealHistoryText(args.restaurantKey, 500);
  const restaurantName = cleanMealHistoryText(args.restaurantName, 180);
  const roadAddress = cleanMealHistoryText(args.roadAddress, 300);
  const address = cleanMealHistoryText(args.address, 300);
  const source = normalizeSource(args.source);
  const rating = normalizeMealHistoryRating(args.rating);
  const privateComment = cleanMealHistoryText(args.privateComment, 1000);

  if (!clientAttemptId || !restaurantKey || !restaurantName) {
    return null;
  }

  const resolvedFood = await resolveFoodForMeal({
    foodId: args.foodId,
    menuName: args.menuName,
  });

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
      private_comment: string;
      tried_at: Date;
      rated_at: Date | null;
    }>
  >`
    INSERT INTO meal_history
    (
      user_id,
      client_attempt_id,
      restaurant_key,
      restaurant_name,
      road_address,
      address,
      food_id,
      menu_name,
      source,
      rating,
      private_comment,
      tried_at,
      rated_at,
      created_at,
      updated_at
    )
    VALUES
    (
      ${args.userId},
      ${clientAttemptId},
      ${restaurantKey},
      ${restaurantName},
      ${roadAddress},
      ${address},
      ${resolvedFood.foodId},
      ${resolvedFood.menuName},
      ${source},
      ${rating},
      ${privateComment},
      CURRENT_TIMESTAMP,
      ${rating ? new Date() : null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id, client_attempt_id)
    DO UPDATE SET
      restaurant_key = EXCLUDED.restaurant_key,
      restaurant_name = EXCLUDED.restaurant_name,
      road_address = EXCLUDED.road_address,
      address = EXCLUDED.address,
      food_id = EXCLUDED.food_id,
      menu_name = EXCLUDED.menu_name,
      source = EXCLUDED.source,
      rating = EXCLUDED.rating,
      private_comment = EXCLUDED.private_comment,
      rated_at = EXCLUDED.rated_at,
      updated_at = CURRENT_TIMESTAMP
    RETURNING
      id,
      restaurant_key,
      restaurant_name,
      road_address,
      address,
      food_id,
      menu_name,
      source,
      rating,
      private_comment,
      tried_at,
      rated_at
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id.toString(),
    restaurantKey: row.restaurant_key,
    restaurantName: row.restaurant_name,
    roadAddress: row.road_address,
    address: row.address,
    foodId: row.food_id?.toString() ?? null,
    menuName: row.menu_name,
    source: normalizeSource(row.source),
    rating: row.rating === 1 ? 1 : row.rating === -1 ? -1 : null,
    privateComment: row.private_comment ?? "",
    triedAt: row.tried_at.toISOString(),
    ratedAt: row.rated_at?.toISOString() ?? null,
  } satisfies MealHistoryEntry;
}
