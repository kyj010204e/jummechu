import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getUserId } from "@/lib/session";

import {
  ALL_PREFERENCE_MENU_NAMES,
  getPreferenceCategoryIds,
  MIN_DETAIL_PREFERENCES,
} from "@/lib/preference-catalog";

import {
  NextRequest,
  NextResponse,
} from "next/server";

type FoodEmbeddingRow = {
  id: bigint;
  name: string;
  embedding_text: string;
  embedding_dim: number;
  model_name: string;
};

type SavedFoodRow = {
  name: string;
  weight: number;
};

function parsePgVector(value: string) {
  const text = value.trim();

  if (
    !text.startsWith("{") ||
    !text.endsWith("}")
  ) {
    throw new Error(
      "잘못된 embedding 형식입니다."
    );
  }

  const body = text.slice(1, -1);

  if (!body) {
    return [];
  }

  return body
    .split(",")
    .map((item) => Number(item));
}

function normalizeVector(
  vector: number[]
) {
  let sum = 0;

  for (const value of vector) {
    sum += value * value;
  }

  const norm = Math.sqrt(sum);

  if (
    !Number.isFinite(norm) ||
    norm === 0
  ) {
    return [...vector];
  }

  return vector.map(
    (value) => value / norm
  );
}

function meanVector(
  vectors: number[][]
) {
  if (vectors.length === 0) {
    return [];
  }

  const dimension =
    vectors[0].length;

  const result =
    new Array<number>(
      dimension
    ).fill(0);

  for (const vector of vectors) {
    if (
      vector.length !==
      dimension
    ) {
      throw new Error(
        "embedding 차원이 다릅니다."
      );
    }

    for (
      let i = 0;
      i < dimension;
      i++
    ) {
      result[i] += vector[i];
    }
  }

  for (
    let i = 0;
    i < dimension;
    i++
  ) {
    result[i] /= vectors.length;
  }

  return result;
}

function weightedMeanVector(
  items: Array<{
    vector: number[];
    weight: number;
  }>
) {
  if (items.length === 0) {
    return [];
  }

  const dimension =
    items[0].vector.length;

  const result =
    new Array<number>(
      dimension
    ).fill(0);

  let totalWeight = 0;

  for (const item of items) {
    if (
      item.vector.length !==
      dimension
    ) {
      throw new Error(
        "embedding 차원이 다릅니다."
      );
    }

    const weight =
      Number.isFinite(
        item.weight
      ) &&
      item.weight > 0
        ? item.weight
        : 1;

    totalWeight += weight;

    for (
      let i = 0;
      i < dimension;
      i++
    ) {
      result[i] +=
        item.vector[i] *
        weight;
    }
  }

  if (totalWeight <= 0) {
    return meanVector(
      items.map(
        (item) => item.vector
      )
    );
  }

  for (
    let i = 0;
    i < dimension;
    i++
  ) {
    result[i] /=
      totalWeight;
  }

  return result;
}


function centerVector(
  vector: number[],
  globalMean: number[]
) {
  const normalized =
    normalizeVector(vector);

  if (
    normalized.length !==
    globalMean.length
  ) {
    throw new Error(
      "embedding 차원이 다릅니다."
    );
  }

  const centered =
    normalized.map(
      (value, index) =>
        value - globalMean[index]
    );

  return normalizeVector(
    centered
  );
}

function vectorToPgArrayText(
  vector: number[]
) {
  return (
    "{" +
    vector
      .map((value) =>
        Number.isFinite(value)
          ? String(value)
          : "0"
      )
      .join(",") +
    "}"
  );
}

function normalizeMenuArray(
  value: unknown
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter(
          (item) =>
            typeof item === "string"
        )
        .map(
          (item) =>
            item.trim()
        )
        .filter(Boolean)
    )
  );
}

/* =========================================================
   GET
========================================================= */

export async function GET() {
  try {
    const userId =
      await getUserId();

    if (!userId) {
      return NextResponse.json(
        {
          message:
            "로그인이 필요합니다.",
        },
        {
          status: 401,
        }
      );
    }

    const limited =
      rateLimit(
        "preferences-get-user",
        30,
        60_000,
        userId.toString()
      );

    if (limited) {
      return limited;
    }

    const savedFoods =
      await prisma.$queryRaw<
        SavedFoodRow[]
      >`
        SELECT
          f.name,
          ufp.weight

        FROM user_food_preferences ufp

        JOIN foods f
          ON f.id = ufp.food_id

        WHERE
          ufp.user_id = ${userId}

        ORDER BY
          ufp.id
      `;

    const selectedMenus =
      savedFoods.map(
        (food) => food.name
      );

    const favoriteMenus =
      savedFoods
        .filter(
          (food) =>
            Number(
              food.weight
            ) > 1
        )
        .map(
          (food) =>
            food.name
        );

    const selectedCategoryIds =
      getPreferenceCategoryIds(
        selectedMenus
      );

    return NextResponse.json({
      /*
       * v2/v3 새 응답
       */
      selectedMenus,
      favoriteMenus,
      selectedCategoryIds,

      /*
       * 기존 로그인/지도 코드 호환용.
       *
       * 예전 화면들은 data.preferences 길이로
       * 온보딩 완료 여부를 검사하고 있으므로,
       * 세부 메뉴 목록을 preferences 별칭으로도 내려줍니다.
       *
       * 최소 5개 세부 메뉴를 선택했다면
       * 기존의 "3개 이상" 검사도 자연스럽게 통과합니다.
       */
      preferences:
        selectedMenus,

      hasPreferences:
        selectedMenus.length >=
        MIN_DETAIL_PREFERENCES,

      minSelections:
        MIN_DETAIL_PREFERENCES,
    });
  } catch (error) {
    console.error(
      "Preferences GET error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "선호 메뉴를 불러오지 못했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}

/* =========================================================
   POST
   세부 선호 메뉴 저장 + user taste embedding 재생성
========================================================= */

export async function POST(
  request: NextRequest
) {
  try {
    const userId =
      await getUserId();

    if (!userId) {
      return NextResponse.json(
        {
          message:
            "로그인이 필요합니다.",
        },
        {
          status: 401,
        }
      );
    }

    const limited =
      rateLimit(
        "preferences-post-user",
        10,
        60_000,
        userId.toString()
      );

    if (limited) {
      return limited;
    }

    let body: unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          message:
            "올바른 JSON 형식이 아닙니다.",
        },
        {
          status: 400,
        }
      );
    }

    const selectedMenus =
      normalizeMenuArray(
        (
          body as {
            selectedMenus?: unknown;
            favoriteMenus?: unknown;
          } | null
        )?.selectedMenus
      );

    const favoriteMenus =
      normalizeMenuArray(
        (
          body as {
            selectedMenus?: unknown;
            favoriteMenus?: unknown;
          } | null
        )?.favoriteMenus
      );

    if (
      selectedMenus.length <
      MIN_DETAIL_PREFERENCES
    ) {
      return NextResponse.json(
        {
          message:
            `세부 메뉴를 최소 ${MIN_DETAIL_PREFERENCES}개 선택해주세요.`,
        },
        {
          status: 400,
        }
      );
    }

    const allowedMenus =
      new Set(
        ALL_PREFERENCE_MENU_NAMES
      );

    const invalidMenus =
      selectedMenus.filter(
        (menu) =>
          !allowedMenus.has(menu)
      );

    if (
      invalidMenus.length > 0
    ) {
      return NextResponse.json(
        {
          message:
            "선택할 수 없는 메뉴가 포함되어 있습니다.",
          invalidMenus,
        },
        {
          status: 400,
        }
      );
    }

    const selectedMenuSet =
      new Set(
        selectedMenus
      );

    const invalidFavorites =
      favoriteMenus.filter(
        (menu) =>
          !selectedMenuSet.has(
            menu
          )
      );

    if (
      invalidFavorites.length > 0
    ) {
      return NextResponse.json(
        {
          message:
            "최애 메뉴는 먼저 선호 메뉴로 선택되어 있어야 합니다.",
          invalidFavorites,
        },
        {
          status: 400,
        }
      );
    }

    /*
     * 전체 음식 embedding으로 global mean을 계산합니다.
     * 현재 Food Master가 약 400개라 저장 시 1회 조회해도 충분히 가볍습니다.
     */
    const allFoodRows =
      await prisma.$queryRaw<
        FoodEmbeddingRow[]
      >`
        SELECT
          f.id,
          f.name,

          fe.embedding::text
            AS embedding_text,

          fe.embedding_dim,
          fe.model_name

        FROM foods f

        JOIN food_embeddings fe
          ON fe.food_id = f.id

        ORDER BY
          f.id
      `;

    if (
      allFoodRows.length === 0
    ) {
      return NextResponse.json(
        {
          message:
            "음식 embedding 데이터가 없습니다.",
        },
        {
          status: 500,
        }
      );
    }

    const parsedFoods =
      allFoodRows.map(
        (row) => ({
          ...row,
          vector:
            parsePgVector(
              row.embedding_text
            ),
        })
      );

    const firstDimension =
      parsedFoods[0]
        .embedding_dim;

    const invalidDimension =
      parsedFoods.some(
        (food) =>
          food.vector.length !==
            firstDimension ||
          food.embedding_dim !==
            firstDimension
      );

    if (invalidDimension) {
      throw new Error(
        "food embedding 차원이 일치하지 않습니다."
      );
    }

    const foodByName =
      new Map(
        parsedFoods.map(
          (food) => [
            food.name,
            food,
          ]
        )
      );

    const selectedFoods =
      selectedMenus
        .map(
          (menu) =>
            foodByName.get(menu)
        )
        .filter(
          (
            food
          ): food is
            (typeof parsedFoods)[number] =>
            Boolean(food)
        );

    if (
      selectedFoods.length !==
      selectedMenus.length
    ) {
      const found =
        new Set(
          selectedFoods.map(
            (food) => food.name
          )
        );

      const missingMenus =
        selectedMenus.filter(
          (menu) =>
            !found.has(menu)
        );

      return NextResponse.json(
        {
          message:
            "Food Master에 없는 메뉴가 포함되어 있습니다.",
          missingMenus,
        },
        {
          status: 409,
        }
      );
    }

    const globalMean =
      meanVector(
        parsedFoods.map(
          (food) =>
            normalizeVector(
              food.vector
            )
        )
      );

    /*
     * v3:
     * 일반 선호 메뉴 = weight 1.0
     * 최애 메뉴       = weight 2.0
     *
     * 선택 메뉴가 많아져도 최애 메뉴가 사용자 벡터의 중심을
     * 더 강하게 잡아주도록 가중 평균을 사용합니다.
     */
    const favoriteMenuSet =
      new Set(
        favoriteMenus
      );

    const weightedSelected =
      selectedFoods.map(
        (food) => ({
          vector:
            centerVector(
              food.vector,
              globalMean
            ),

          weight:
            favoriteMenuSet.has(
              food.name
            )
              ? 2.0
              : 1.0,
        })
      );

    const userTasteVector =
      normalizeVector(
        weightedMeanVector(
          weightedSelected
        )
      );

    const embeddingText =
      vectorToPgArrayText(
        userTasteVector
      );

    const categoryIds =
      getPreferenceCategoryIds(
        selectedMenus
      );

    const modelName =
      selectedFoods[0]
        .model_name;

    /*
     * Prisma 7 환경에서 Prisma.sql helper가 런타임에
     * 함수로 노출되지 않는 경우가 있으므로 사용하지 않습니다.
     *
     * 대신 JSONB -> jsonb_to_recordset()으로
     * 여러 행을 한 번에 INSERT 합니다.
     *
     * 이렇게 하면 30~80개 메뉴를 선택해도
     * INSERT를 1건씩 반복하지 않아도 됩니다.
     */

    const categoryRowsJson =
      JSON.stringify(
        categoryIds.map(
          (categoryId) => ({
            user_id:
              userId.toString(),

            menu_type:
              categoryId,
          })
        )
      );


    const foodRowsJson =
      JSON.stringify(
        selectedFoods.map(
          (food) => ({
            user_id:
              userId.toString(),

            food_id:
              food.id.toString(),

            weight:
              favoriteMenuSet.has(
                food.name
              )
                ? 2.0
                : 1.0,

            source:
              "preference_ui",
          })
        )
      );


    await prisma.$transaction(
      async (tx) => {

        /*
         * 상위 카테고리 저장
         */
        await tx.$executeRaw`
          DELETE FROM user_preferences
          WHERE user_id = ${userId}
        `;


        if (
          categoryIds.length > 0
        ) {

          await tx.$executeRaw`
            INSERT INTO user_preferences
            (
              user_id,
              menu_type,
              created_at
            )

            SELECT
              data.user_id::bigint,
              data.menu_type,
              CURRENT_TIMESTAMP

            FROM jsonb_to_recordset(
              ${categoryRowsJson}::jsonb
            )
            AS data(
              user_id text,
              menu_type text
            )
          `;
        }


        /*
         * 실제 상세 메뉴 취향 저장
         */
        await tx.$executeRaw`
          DELETE FROM user_food_preferences
          WHERE user_id = ${userId}
        `;


        if (
          selectedFoods.length > 0
        ) {

          await tx.$executeRaw`
            INSERT INTO user_food_preferences
            (
              user_id,
              food_id,
              weight,
              source,
              created_at
            )

            SELECT
              data.user_id::bigint,
              data.food_id::bigint,
              data.weight::double precision,
              data.source,
              CURRENT_TIMESTAMP

            FROM jsonb_to_recordset(
              ${foodRowsJson}::jsonb
            )
            AS data(
              user_id text,
              food_id text,
              weight double precision,
              source text
            )
          `;
        }


        /*
         * 사용자 취향 embedding 갱신
         */
        await tx.$executeRaw`
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
            ${embeddingText}
              ::double precision[],
            ${firstDimension},
            ${modelName},
            ${selectedFoods.length},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )

          ON CONFLICT
            (user_id)

          DO UPDATE SET
            embedding =
              EXCLUDED.embedding,

            embedding_dim =
              EXCLUDED.embedding_dim,

            model_name =
              EXCLUDED.model_name,

            preference_count =
              EXCLUDED.preference_count,

            updated_at =
              CURRENT_TIMESTAMP
        `;
      },
      {
        maxWait:
          10_000,

        timeout:
          30_000,
      }
    );


    return NextResponse.json({
      message:
        "선호 메뉴를 저장했습니다.",

      selectedMenus,
      favoriteMenus,

      selectedCategoryIds:
        categoryIds,

      /*
       * 기존 클라이언트 호환용
       */
      preferences:
        selectedMenus,

      hasPreferences:
        selectedMenus.length >=
        MIN_DETAIL_PREFERENCES,

      preferenceCount:
        selectedMenus.length,
    });
  } catch (error) {
    console.error(
      "Preferences POST error:",
      error
    );

    return NextResponse.json(
      {
        message:
          "선호 메뉴 저장 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}
