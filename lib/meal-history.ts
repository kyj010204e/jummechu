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
  triedAt: string;
  ratedAt: string | null;
};

function normalizeSource(value: unknown): MealHistorySource {
  return value === "exploration" ? "exploration" : "recommendation";
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
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
          tried_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          rated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
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
  const foodIdText = cleanText(args.foodId, 40);
  const menuName = cleanText(args.menuName, 120);

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
}) {
  await ensureMealHistoryTable();

  const clientAttemptId = cleanText(args.clientAttemptId, 100);
  const restaurantKey = cleanText(args.restaurantKey, 500);
  const restaurantName = cleanText(args.restaurantName, 180);
  const roadAddress = cleanText(args.roadAddress, 300);
  const address = cleanText(args.address, 300);
  const source = normalizeSource(args.source);

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
      tried_at,
      created_at
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
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (user_id, client_attempt_id)
    DO UPDATE SET
      restaurant_key = EXCLUDED.restaurant_key
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
    triedAt: row.tried_at.toISOString(),
    ratedAt: row.rated_at?.toISOString() ?? null,
  } satisfies MealHistoryEntry;
}
