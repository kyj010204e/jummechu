import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import {
  parseCoordinate,
  parsePreferences,
} from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";

import {
  NextRequest,
  NextResponse,
} from "next/server";


/* =========================================================
   기본 설정
========================================================= */

const CANDIDATE_POOL_SIZE = 100;
const RECOMMEND_TOP_K = 20;

/*
 * NAVER에 실제 검색할 추천 메뉴 수
 *
 * Top 20을 전부 검색하면
 * 요청 수가 너무 많아질 수 있으므로
 * 우선 상위 8개만 사용
 */
const NAVER_SEARCH_MENU_COUNT = 8;

/*
 * 정확한 추천 메뉴 검색 외에
 * 메뉴 family(김밥/초밥/비빔밥 등) 검색을 추가해
 * 주변 음식점 후보를 더 넓게 수집합니다.
 *
 * 최대 외부 검색 요청:
 * 정확 메뉴 8개 + family 6개 = 14개
 */
const NAVER_FAMILY_SEARCH_COUNT = 6;

const EXCLUDED_NAVER_FAMILIES =
  new Set([
    "기타",
    "밥",
  ]);


/*
 * 사용자 대표 취향
 * +
 * 개별 실제 메뉴 취향
 */
const PROFILE_WEIGHT = 0.60;
const BEST_ANCHOR_WEIGHT = 0.30;
const MEAN_ANCHOR_WEIGHT = 0.10;


/*
 * MMR
 *
 * 높을수록 취향 중심
 * 낮을수록 다양성 중심
 */
const MMR_LAMBDA = 0.70;


/*
 * 동일 메뉴 계열 최대 개수
 */
const MAX_PER_FAMILY = 2;


/*
 * 최소 취향 점수
 */
const ABSOLUTE_MIN_SCORE = 0.30;
const RELATIVE_MIN_RATIO = 0.50;


/*
 * 음식점 검색 반경
 *
 * 프론트에서는 3km / 5km를 선택하고,
 * 서버는 최대 5km 후보를 내려줍니다.
 */
const DEFAULT_RADIUS_KM = 5;
const ALLOWED_RADIUS_KM =
  new Set([
    1,
    2,
    3,
    4,
    5,
  ]);


/* =========================================================
   NAVER 타입
========================================================= */

type ReverseGeocodeResult = {
  name: string;

  region: {
    area1?: {
      name?: string;
    };

    area2?: {
      name?: string;
    };

    area3?: {
      name?: string;
    };

    area4?: {
      name?: string;
    };
  };
};


type ReverseGeocodeResponse = {
  status?: {
    code?: number;
    name?: string;
    message?: string;
  };

  results?: ReverseGeocodeResult[];
};


type NaverLocalItem = {
  title: string;
  link: string;
  category: string;
  description: string;
  telephone: string;
  address: string;
  roadAddress: string;
  mapx: string;
  mapy: string;
};


type NaverLocalResponse = {
  items?: NaverLocalItem[];
};


/* =========================================================
   응답 음식점 타입
========================================================= */

type Restaurant = {
  id: string;

  name: string;

  category: string;

  address: string;

  roadAddress: string;

  link: string;

  latitude: number;

  longitude: number;

  distance: number;

  /*
   * 어떤 추천 메뉴 검색으로
   * 이 음식점을 찾았는지
   */
  matchedPreferences: string[];

  /*
   * AI 메뉴 취향 점수
   */
  preferenceScore: number;

  /*
   * 거리 점수
   */
  distanceScore: number;

  /*
   * 최종 추천 점수
   */
  recommendScore: number;
};


/* =========================================================
   Raw DB 타입
========================================================= */

type RawUserTasteRow = {
  embedding_text: string;
  embedding_dim: number;
  model_name: string;
};


type RawFoodEmbeddingRow = {
  id: bigint;

  name: string;

  cuisine_type: string | null;

  food_type: string | null;

  embedding_text: string;
};


type RawSelectedFoodRow = {
  id: bigint;

  name: string;

  weight: number;

  source: string;

  embedding_text: string;
};


/* =========================================================
   내부 Food 타입
========================================================= */

type FoodEmbedding = {
  id: string;

  name: string;

  cuisineType: string | null;

  foodType: string | null;

  vector: number[];
};


type SelectedFood = {
  id: string;

  name: string;

  weight: number;

  source: string;

  vector: number[];
};


type PreferenceAnchor = {
  id: string;

  name: string;

  weight: number;

  vector: number[];
};


type RecommendationCandidate = {
  id: string;

  name: string;

  cuisineType: string | null;

  foodType: string | null;

  family: string;

  vector: number[];

  profileSimilarity: number;

  bestAnchor: string | null;

  anchorSimilarity: number;

  meanAnchorSimilarity: number;

  baseScore: number;

  mmrScore?: number;
};


type SearchTermKind =
  | "menu"
  | "family"
  | "category";


type SearchTerm = {
  /*
   * NAVER에 실제로 넣는 검색어
   * 예: "김치김밥", "김밥"
   */
  name: string;

  /*
   * 이 검색어가 어떤 AI 추천 메뉴에서 파생됐는지
   *
   * family 검색으로 찾은 식당도
   * 원래 추천 메뉴와 연결해 설명할 수 있게 합니다.
   */
  sourceMenu: string;

  /*
   * 메뉴 적합도 점수
   */
  score: number;

  kind: SearchTermKind;
};


/* =========================================================
   기존 카테고리 fallback
========================================================= */

const PREFERENCE_KEYWORDS:
  Record<string, string> = {

  korean: "한식",

  noodle: "면",

  noodles: "면",

  chicken: "치킨",

  pizza: "피자",

  meat: "고기",

  japanese: "일식",

  burger: "버거",

  chinese: "중식",

  cafe: "카페",

  한식: "한식",

  면류: "면",

  면: "면",

  치킨: "치킨",

  피자: "피자",

  고기: "고기",

  일식: "일식",

  버거: "버거",

  중식: "중식",

  카페: "카페",
};


/* =========================================================
   HTML 제거
========================================================= */

function stripHtml(
  value: string
) {

  return value.replace(
    /<[^>]*>/g,
    ""
  );
}


/* =========================================================
   숫자 clamp
========================================================= */

function clamp(
  value: number,
  min: number,
  max: number
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


/* =========================================================
   PG double precision[] 문자열 파싱

   예:
   {0.123,-0.456,...}
========================================================= */

function parsePgVector(
  value: string
) {

  const text =
    value.trim();

  if (
    !text.startsWith("{") ||
    !text.endsWith("}")
  ) {

    throw new Error(
      "잘못된 embedding 형식입니다."
    );
  }

  const body =
    text.slice(
      1,
      -1
    );

  if (!body) {
    return [];
  }

  return body
    .split(",")
    .map(
      (item) =>
        Number(item)
    );
}


/* =========================================================
   Vector normalize
========================================================= */

function normalizeVector(
  vector: number[]
) {

  let sum = 0;

  for (
    const value
    of vector
  ) {

    sum +=
      value * value;
  }

  const norm =
    Math.sqrt(sum);

  if (norm === 0) {

    return [
      ...vector,
    ];
  }

  return vector.map(
    (value) =>
      value / norm
  );
}


/* =========================================================
   Dot product
========================================================= */

function dotProduct(
  a: number[],
  b: number[]
) {

  if (
    a.length
    !== b.length
  ) {

    throw new Error(
      "embedding 차원이 다릅니다."
    );
  }

  let result = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    result +=
      a[i] * b[i];
  }

  return result;
}


/* =========================================================
   Vector 평균
========================================================= */

function meanVector(
  vectors: number[][]
) {

  if (
    vectors.length === 0
  ) {

    return [];
  }

  const dimension =
    vectors[0].length;

  const result =
    new Array<number>(
      dimension
    ).fill(0);

  for (
    const vector
    of vectors
  ) {

    if (
      vector.length
      !== dimension
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

      result[i] +=
        vector[i];
    }
  }

  for (
    let i = 0;
    i < dimension;
    i++
  ) {

    result[i] /=
      vectors.length;
  }

  return result;
}


/* =========================================================
   Global Mean
========================================================= */

function makeGlobalMean(
  foods: FoodEmbedding[]
) {

  const normalized =
    foods.map(
      (food) =>
        normalizeVector(
          food.vector
        )
    );

  return meanVector(
    normalized
  );
}


/* =========================================================
   중심 보정
========================================================= */

function centerVector(
  vector: number[],
  globalMean: number[]
) {

  const normalized =
    normalizeVector(
      vector
    );

  const centered =
    normalized.map(
      (value, index) =>
        value -
        globalMean[index]
    );

  return normalizeVector(
    centered
  );
}


/* =========================================================
   메뉴 Family
========================================================= */

function getFoodFamily(
  name: string,
  foodType: string | null
) {

  if (
    name.includes("초밥")
  ) {
    return "초밥";
  }

  if (
    name.includes("김밥")
  ) {
    return "김밥";
  }

  if (
    name.includes("비빔밥")
  ) {
    return "비빔밥";
  }

  if (
    name.includes("볶음밥")
  ) {
    return "볶음밥";
  }

  if (
    name.includes("덮밥")
  ) {
    return "덮밥";
  }

  if (
    name.includes("국밥")
  ) {
    return "국밥";
  }


  if (
    name.includes("라면")
  ) {
    return "라면";
  }

  if (
    name.includes("냉면")
  ) {
    return "냉면";
  }

  if (
    name.includes("우동")
  ) {
    return "우동";
  }

  if (
    name.includes("칼국수")
  ) {
    return "칼국수";
  }

  if (
    name.includes("국수") ||
    name.includes("쫄면") ||
    name.includes("짬뽕") ||
    name.includes("자장")
  ) {

    return "면류";
  }


  if (
    name.includes("치킨") ||
    name.includes("닭튀김")
  ) {

    return "치킨";
  }


  if (
    name.includes("돈가스") ||
    name.includes("돈까스")
  ) {

    return "돈가스";
  }


  if (
    name.includes("버거")
  ) {

    return "버거";
  }


  if (
    name.includes("피자")
  ) {

    return "피자";
  }


  if (
    name.includes("찌개")
  ) {

    return "찌개";
  }


  if (
    name.includes("전골")
  ) {

    return "전골";
  }


  if (
    name.includes("국")
  ) {

    return "국";
  }


  if (
    name.includes("탕")
  ) {

    return "탕";
  }


  if (
    name.includes("구이")
  ) {

    return "구이";
  }


  if (
    name.includes("튀김")
  ) {

    return "튀김";
  }


  if (
    name.includes("볶음")
  ) {

    return "볶음";
  }


  if (
    name.includes("조림")
  ) {

    return "조림";
  }


  if (
    name.includes("찜")
  ) {

    return "찜";
  }


  if (
    name.includes("전")
  ) {

    return "전";
  }


  if (
    name.includes("무침")
  ) {

    return "무침";
  }


  if (
    name.includes("죽")
  ) {

    return "죽";
  }


  if (
    name.includes("떡")
  ) {

    return "떡";
  }


  return (
    foodType ||
    "기타"
  );
}


/* =========================================================
   실제 선호 음식 → Anchor
========================================================= */

function makeAnchors(
  selectedFoods: SelectedFood[],
  globalMean: number[]
) {

  return selectedFoods.map(
    (food): PreferenceAnchor => ({

      id:
        food.id,

      name:
        food.name,

      weight:
        food.weight,

      vector:
        centerVector(
          food.vector,
          globalMean
        ),
    })
  );
}


/* =========================================================
   후보 생성
========================================================= */

function makeCandidatePool(
  userEmbedding: number[],
  foods: FoodEmbedding[],
  selectedFoodIds: Set<string>,
  anchors: PreferenceAnchor[],
  globalMean: number[]
) {

  /*
   * user_taste_embeddings에는
   * 이미 중심 보정된 사용자 벡터가 저장됨
   */
  const userVector =
    normalizeVector(
      userEmbedding
    );

  const candidates:
    RecommendationCandidate[] = [];


  for (
    const food
    of foods
  ) {

    if (
      selectedFoodIds.has(
        food.id
      )
    ) {

      continue;
    }


    const foodVector =
      centerVector(
        food.vector,
        globalMean
      );


    const profileSimilarity =
      dotProduct(
        userVector,
        foodVector
      );


    let bestAnchor:
      string | null =
        null;

    let bestAnchorSimilarity =
      profileSimilarity;

    let meanAnchorSimilarity =
      profileSimilarity;


    if (
      anchors.length > 0
    ) {

      const anchorScores =
        anchors.map(
          (anchor) => ({

            name:
              anchor.name,

            similarity:
              dotProduct(
                anchor.vector,
                foodVector
              ),
          })
        );


      const sorted =
        [...anchorScores].sort(
          (a, b) =>
            b.similarity -
            a.similarity
        );


      bestAnchor =
        sorted[0].name;

      bestAnchorSimilarity =
        sorted[0].similarity;


      meanAnchorSimilarity =
        anchorScores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.similarity,
          0
        ) /
        anchorScores.length;
    }


    const baseScore =

      PROFILE_WEIGHT *
      profileSimilarity

      +

      BEST_ANCHOR_WEIGHT *
      bestAnchorSimilarity

      +

      MEAN_ANCHOR_WEIGHT *
      meanAnchorSimilarity;


    candidates.push({

      id:
        food.id,

      name:
        food.name,

      cuisineType:
        food.cuisineType,

      foodType:
        food.foodType,

      family:
        getFoodFamily(
          food.name,
          food.foodType
        ),

      vector:
        foodVector,

      profileSimilarity,

      bestAnchor,

      anchorSimilarity:
        bestAnchorSimilarity,

      meanAnchorSimilarity,

      baseScore,
    });
  }


  candidates.sort(
    (a, b) =>
      b.baseScore -
      a.baseScore
  );


  if (
    candidates.length === 0
  ) {

    return [];
  }


  const bestScore =
    candidates[0].baseScore;


  const desiredMinScore =
    Math.max(
      ABSOLUTE_MIN_SCORE,
      bestScore *
        RELATIVE_MIN_RATIO
    );


  /*
   * 최고점 자체가 0.30보다 낮은
   * 신규/희박한 사용자도
   * 최소 하나는 추천되도록 처리
   */
  const minScore =
    Math.min(
      bestScore,
      desiredMinScore
    );


  return candidates
    .filter(
      (candidate) =>
        candidate.baseScore
        >= minScore
    )
    .slice(
      0,
      CANDIDATE_POOL_SIZE
    );
}


/* =========================================================
   MMR
========================================================= */

function rerankWithMmr(
  candidates:
    RecommendationCandidate[],

  anchors:
    PreferenceAnchor[],

  topK: number
) {

  if (
    candidates.length === 0
  ) {

    return [];
  }


  let remaining =
    [...candidates];


  const results:
    RecommendationCandidate[] = [];


  const familyCounts =
    new Map<
      string,
      number
    >();


  const anchorCounts =
    new Map<
      string,
      number
    >();


  /* -------------------------------------------------------
     실제 메뉴 취향별 1개 우선 확보
  ------------------------------------------------------- */

  for (
    const anchor
    of anchors
  ) {

    const available =
      remaining.filter(
        (candidate) =>
          candidate.bestAnchor
          === anchor.name
      );


    if (
      available.length === 0
    ) {

      continue;
    }


    available.sort(
      (a, b) =>
        b.anchorSimilarity -
        a.anchorSimilarity
    );


    const best = {
      ...available[0],
    };


    const familyCount =
      familyCounts.get(
        best.family
      ) ?? 0;


    if (
      familyCount
      >= MAX_PER_FAMILY
    ) {

      continue;
    }


    best.mmrScore =
      best.baseScore;


    results.push(
      best
    );


    familyCounts.set(
      best.family,
      familyCount + 1
    );


    anchorCounts.set(
      anchor.name,

      (
        anchorCounts.get(
          anchor.name
        ) ?? 0
      ) + 1
    );


    remaining =
      remaining.filter(
        (item) =>
          item.id
          !== best.id
      );


    if (
      results.length
      >= topK
    ) {

      return results;
    }
  }


  const maxPerAnchor =
    anchors.length > 0

      ? Math.max(
          3,

          Math.ceil(
            topK /
            anchors.length
          )
        )

      : topK;


  /* -------------------------------------------------------
     MMR
  ------------------------------------------------------- */

  while (
    remaining.length > 0 &&
    results.length < topK
  ) {

    let bestCandidate:
      RecommendationCandidate |
      null =
        null;


    let bestMmrScore =
      Number.NEGATIVE_INFINITY;


    for (
      const candidate
      of remaining
    ) {

      const familyCount =
        familyCounts.get(
          candidate.family
        ) ?? 0;


      if (
        familyCount
        >= MAX_PER_FAMILY
      ) {

        continue;
      }


      if (
        candidate.bestAnchor
      ) {

        const anchorCount =
          anchorCounts.get(
            candidate.bestAnchor
          ) ?? 0;


        if (
          anchorCount
          >= maxPerAnchor
        ) {

          continue;
        }
      }


      let redundancy = 0;


      if (
        results.length > 0
      ) {

        redundancy =
          Math.max(
            ...results.map(
              (selected) =>
                dotProduct(
                  candidate.vector,
                  selected.vector
                )
            )
          );
      }


      const mmrScore =

        MMR_LAMBDA *
        candidate.baseScore

        -

        (
          1 -
          MMR_LAMBDA
        ) *
        redundancy;


      if (
        mmrScore >
        bestMmrScore
      ) {

        bestMmrScore =
          mmrScore;

        bestCandidate =
          candidate;
      }
    }


    if (
      !bestCandidate
    ) {

      break;
    }


    const selected = {
      ...bestCandidate,

      mmrScore:
        bestMmrScore,
    };


    results.push(
      selected
    );


    familyCounts.set(

      selected.family,

      (
        familyCounts.get(
          selected.family
        ) ?? 0
      ) + 1
    );


    if (
      selected.bestAnchor
    ) {

      anchorCounts.set(

        selected.bestAnchor,

        (
          anchorCounts.get(
            selected.bestAnchor
          ) ?? 0
        ) + 1
      );
    }


    remaining =
      remaining.filter(
        (item) =>
          item.id
          !== selected.id
      );
  }


  /* -------------------------------------------------------
     부족한 자리는 fallback
  ------------------------------------------------------- */

  if (
    results.length < topK
  ) {

    const selectedIds =
      new Set(
        results.map(
          (item) =>
            item.id
        )
      );


    const fallback =
      candidates
        .filter(
          (candidate) =>
            !selectedIds.has(
              candidate.id
            )
        )
        .sort(
          (a, b) =>
            b.baseScore -
            a.baseScore
        );


    for (
      const candidate
      of fallback
    ) {

      results.push({

        ...candidate,

        mmrScore:
          candidate.baseScore,
      });


      if (
        results.length
        >= topK
      ) {

        break;
      }
    }
  }


  return results;
}


/* =========================================================
   AI 메뉴 추천
========================================================= */

async function buildUserRecommendations(
  userId: bigint
) {

  /*
   * embedding을 ::text로 가져오는 이유:
   *
   * Prisma schema에 vector 테이블을
   * 모델로 정의하지 않아도
   * 안전하게 사용할 수 있음.
   */

  const userRows =
    await prisma.$queryRaw<
      RawUserTasteRow[]
    >`
      SELECT
        embedding::text
          AS embedding_text,

        embedding_dim,

        model_name

      FROM user_taste_embeddings

      WHERE user_id = ${userId}

      LIMIT 1
    `;


  if (
    userRows.length === 0
  ) {

    return null;
  }


  const rawFoods =
    await prisma.$queryRaw<
      RawFoodEmbeddingRow[]
    >`
      SELECT
        f.id,
        f.name,
        f.cuisine_type,
        f.food_type,

        fe.embedding::text
          AS embedding_text

      FROM foods f

      JOIN food_embeddings fe
        ON fe.food_id = f.id

      ORDER BY f.id
    `;


  if (
    rawFoods.length === 0
  ) {

    return null;
  }


  const rawSelected =
    await prisma.$queryRaw<
      RawSelectedFoodRow[]
    >`
      SELECT
        f.id,
        f.name,
        ufp.weight,
        ufp.source,

        fe.embedding::text
          AS embedding_text

      FROM user_food_preferences ufp

      JOIN foods f
        ON f.id = ufp.food_id

      JOIN food_embeddings fe
        ON fe.food_id = f.id

      WHERE
        ufp.user_id =
        ${userId}

      ORDER BY ufp.id
    `;


  const userEmbedding =
    parsePgVector(
      userRows[0]
        .embedding_text
    );


  const foods:
    FoodEmbedding[] =
      rawFoods.map(
        (row) => ({

          id:
            row.id.toString(),

          name:
            row.name,

          cuisineType:
            row.cuisine_type,

          foodType:
            row.food_type,

          vector:
            parsePgVector(
              row.embedding_text
            ),
        })
      );


  const selectedFoods:
    SelectedFood[] =
      rawSelected.map(
        (row) => ({

          id:
            row.id.toString(),

          name:
            row.name,

          weight:
            Number(
              row.weight
            ),

          source:
            row.source,

          vector:
            parsePgVector(
              row.embedding_text
            ),
        })
      );


  if (
    userEmbedding.length
    !== userRows[0]
      .embedding_dim
  ) {

    throw new Error(
      "사용자 embedding 차원이 올바르지 않습니다."
    );
  }


  const globalMean =
    makeGlobalMean(
      foods
    );


  const selectedFoodIds =
    new Set(
      selectedFoods.map(
        (food) =>
          food.id
      )
    );


  const anchors =
    makeAnchors(
      selectedFoods,
      globalMean
    );


  const candidates =
    makeCandidatePool(
      userEmbedding,
      foods,
      selectedFoodIds,
      anchors,
      globalMean
    );


  const recommendations =
    rerankWithMmr(
      candidates,
      anchors,
      RECOMMEND_TOP_K
    );


  return {

    modelName:
      userRows[0]
        .model_name,

    recommendations,

    selectedFoods,
  };
}


/* =========================================================
   실제 NAVER 검색용 메뉴 생성
========================================================= */

function buildNaverSearchTerms(
  recommendations:
    RecommendationCandidate[]
) {

  /*
   * 정확 메뉴 검색과 family 검색을 함께 사용합니다.
   *
   * 예:
   * 김치김밥 -> "김치김밥" + "김밥"
   * 농어초밥 -> "농어초밥" + "초밥"
   *
   * 이렇게 하면 메뉴 하나당 NAVER 상위 5개만 받는
   * Local Search의 후보 부족을 어느 정도 완화할 수 있습니다.
   */

  const scoreToPercent =
    (
      baseScore: number
    ) => {

      const score =
        Math.round(
          (
            clamp(
              baseScore,
              -1,
              1
            ) + 1
          ) / 2 * 100
        );

      return clamp(
        score,
        0,
        100
      );
    };


  /*
   * 쌀밥 / 현미밥처럼
   * 검색 효율이 낮은 "밥" family는
   * 정확 메뉴 우선순위를 뒤로 보냅니다.
   */
  const preferred =
    recommendations.filter(
      (item) =>
        item.family !== "밥"
    );

  const combined = [
    ...preferred,
    ...recommendations,
  ];


  const result:
    SearchTerm[] = [];

  const seenQueries =
    new Set<string>();


  /* -------------------------------------------------------
     1. 정확한 AI 추천 메뉴
  ------------------------------------------------------- */

  for (
    const item
    of combined
  ) {

    const query =
      item.name.trim();

    if (
      !query ||
      seenQueries.has(query)
    ) {

      continue;
    }

    seenQueries.add(
      query
    );

    result.push({
      name:
        query,

      sourceMenu:
        item.name,

      score:
        scoreToPercent(
          item.baseScore
        ),

      kind:
        "menu",
    });


    const exactMenuCount =
      result.filter(
        (term) =>
          term.kind === "menu"
      ).length;

    if (
      exactMenuCount >=
      NAVER_SEARCH_MENU_COUNT
    ) {

      break;
    }
  }


  /* -------------------------------------------------------
     2. 메뉴 family 확장 검색

     family 검색은 정확 메뉴보다 범위가 넓으므로
     적합도 점수를 소폭 낮춰 과대평가를 방지합니다.
  ------------------------------------------------------- */

  let familyCount = 0;

  const seenFamilies =
    new Set<string>();


  for (
    const item
    of recommendations
  ) {

    const family =
      item.family.trim();

    if (
      !family ||
      EXCLUDED_NAVER_FAMILIES.has(
        family
      ) ||
      seenFamilies.has(
        family
      ) ||
      seenQueries.has(
        family
      )
    ) {

      continue;
    }


    seenFamilies.add(
      family
    );

    seenQueries.add(
      family
    );


    result.push({
      name:
        family,

      /*
       * "김밥" 검색으로 발견해도
       * 프론트에서는 원래 AI 추천 메뉴인
       * "김치김밥"과 연결되도록 유지합니다.
       */
      sourceMenu:
        item.name,

      score:
        clamp(
          scoreToPercent(
            item.baseScore
          ) - 5,
          0,
          100
        ),

      kind:
        "family",
    });


    familyCount++;


    if (
      familyCount >=
      NAVER_FAMILY_SEARCH_COUNT
    ) {

      break;
    }
  }


  return result;
}

/* =========================================================
   기존 카테고리 normalize
========================================================= */

function normalizePreference(
  value: string
) {

  return (
    PREFERENCE_KEYWORDS[
      value
    ] ??
    value
  );
}


/* =========================================================
   거리
========================================================= */

function toRadians(
  value: number
) {

  return (
    value *
    Math.PI /
    180
  );
}


function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {

  const earthRadius =
    6371000;


  const dLat =
    toRadians(
      lat2 - lat1
    );


  const dLon =
    toRadians(
      lon2 - lon1
    );


  const a =

    Math.sin(
      dLat / 2
    ) ** 2

    +

    Math.cos(
      toRadians(
        lat1
      )
    )

    *

    Math.cos(
      toRadians(
        lat2
      )
    )

    *

    Math.sin(
      dLon / 2
    ) ** 2;


  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    );


  return Math.round(
    earthRadius *
    c
  );
}


/* =========================================================
   NAVER 좌표
========================================================= */

function parseNaverCoordinate(
  value: string,
  type:
    | "longitude"
    | "latitude"
) {

  let coordinate =
    Number(value);


  if (
    !Number.isFinite(
      coordinate
    )
  ) {

    return NaN;
  }


  /*
   * NAVER Local Search 좌표가
   *
   * 1271234567
   * 361234567
   *
   * 형태라면 WGS84 변환
   */

  if (
    type ===
      "longitude" &&
    Math.abs(
      coordinate
    ) > 180
  ) {

    coordinate =
      coordinate /
      10_000_000;
  }


  if (
    type ===
      "latitude" &&
    Math.abs(
      coordinate
    ) > 90
  ) {

    coordinate =
      coordinate /
      10_000_000;
  }


  return (
    parseCoordinate(
      coordinate,
      type
    ) ??
    NaN
  );
}


/* =========================================================
   GET
========================================================= */

export async function GET(
  request: NextRequest
) {

  try {

    const {
      searchParams,
    } =
      new URL(
        request.url
      );


    /* =====================================================
       로그인
    ===================================================== */

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


    /* =====================================================
       Rate Limit
    ===================================================== */

    const limited =

      rateLimit(
        "restaurants-user",
        20,
        60_000,
        userId.toString()
      )

      ??

      rateLimit(
        "naver-search-global",
        120,
        60_000
      );


    if (limited) {

      return limited;
    }


    /* =====================================================
       좌표
    ===================================================== */

    const latitude =
      parseCoordinate(
        searchParams.get(
          "latitude"
        ),
        "latitude"
      );


    const longitude =
      parseCoordinate(
        searchParams.get(
          "longitude"
        ),
        "longitude"
      );


    if (
      latitude === null ||
      longitude === null
    ) {

      return NextResponse.json(
        {
          message:
            "latitude와 longitude가 필요합니다.",
        },
        {
          status: 400,
        }
      );
    }


    /* =====================================================
       검색 반경

       현재 UI는 3km / 5km만 사용합니다.
       값이 없거나 잘못된 경우 5km로 처리합니다.
    ===================================================== */

    const requestedRadiusKm =
      Number(
        searchParams.get(
          "radiusKm"
        )
      );

    const radiusKm =
      ALLOWED_RADIUS_KM.has(
        requestedRadiusKm
      )
        ? requestedRadiusKm
        : DEFAULT_RADIUS_KM;

    const radiusMeters =
      radiusKm * 1000;


    /* =====================================================
       ENV
    ===================================================== */

    const mapsClientId =
      process.env
        .NAVER_MAPS_CLIENT_ID;


    const mapsClientSecret =
      process.env
        .NAVER_MAPS_CLIENT_SECRET;


    const searchClientId =
      process.env
        .NAVER_SEARCH_CLIENT_ID;


    const searchClientSecret =
      process.env
        .NAVER_SEARCH_CLIENT_SECRET;


    if (
      !mapsClientId ||
      !mapsClientSecret
    ) {

      return NextResponse.json(
        {
          message:
            "NAVER Maps 환경변수가 설정되지 않았습니다.",
        },
        {
          status: 500,
        }
      );
    }


    if (
      !searchClientId ||
      !searchClientSecret
    ) {

      return NextResponse.json(
        {
          message:
            "NAVER Search 환경변수가 설정되지 않았습니다.",
        },
        {
          status: 500,
        }
      );
    }


    /* =====================================================
       1. 기존 초기 카테고리
    ===================================================== */

    const storedPreferences =
      await prisma
        .user_preferences
        .findMany({

          where: {
            user_id:
              userId,
          },

          orderBy: {
            id: "asc",
          },
        });


    const preferences =

      parsePreferences(

        storedPreferences.map(
          (item) =>
            item.menu_type
        )

      ) ?? [];


    const normalizedPreferences =

      Array.from(

        new Set(

          preferences.map(
            normalizePreference
          )
        )
      );


    /* =====================================================
       2. AI 추천 메뉴 생성
    ===================================================== */

    let aiResult:
      Awaited<
        ReturnType<
          typeof buildUserRecommendations
        >
      > =
        null;


    try {

      aiResult =
        await buildUserRecommendations(
          userId
        );

    } catch (error) {

      /*
       * AI 추천 DB에 문제가 있어도
       * 기존 카테고리 검색은 작동하도록
       * fallback
       */
      console.error(
        "AI recommendation error:",
        error
      );

      aiResult =
        null;
    }


    /*
     * 실제 NAVER 검색어
     */

    let searchTerms:
      SearchTerm[] = [];


    if (
      aiResult &&
      aiResult
        .recommendations
        .length > 0
    ) {

      searchTerms =
        buildNaverSearchTerms(
          aiResult
            .recommendations
        );
    }


    /*
     * 사용자 임베딩이 아직 없거나
     * 추천 결과가 없다면
     * 기존 카테고리 검색으로 fallback
     */

    const usingAi =
      searchTerms.length > 0;


    if (!usingAi) {

      const fallbackTerms =
        normalizedPreferences.length > 0

          ? normalizedPreferences

          : ["맛집"];


      searchTerms =
        fallbackTerms.map(
          (name) => ({

            name,

            sourceMenu:
              name,

            /*
             * 기존 카테고리
             * 기본 선호 점수
             */
            score: 60,

            kind:
              "category" as const,
          })
        );
    }


    /* =====================================================
       3. GPS → 행정동
    ===================================================== */

    const reverseUrl =

      "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc"

      +

      `?coords=${longitude},${latitude}`

      +

      "&output=json"

      +

      "&orders=admcode,legalcode";


    const reverseResponse =
      await fetch(
        reverseUrl,
        {

          method: "GET",

          headers: {

            "x-ncp-apigw-api-key-id":
              mapsClientId,

            "x-ncp-apigw-api-key":
              mapsClientSecret,
          },

          cache:
            "no-store",

          signal:
            AbortSignal.timeout(
              10_000
            ),
        }
      );


    if (
      !reverseResponse.ok
    ) {

      const detail =
        await reverseResponse
          .text();


      console.error(
        "Reverse Geocoding error:",
        detail
      );


      return NextResponse.json(
        {
          message:
            "현재 위치의 주소를 찾지 못했습니다.",
        },
        {
          status:
            reverseResponse.status,
        }
      );
    }


    const reverseData =
      (
        await reverseResponse
          .json()
      ) as ReverseGeocodeResponse;


    const regionResult =

      reverseData.results
        ?.find(
          (item) =>
            item.name ===
            "admcode"
        )

      ??

      reverseData.results
        ?.find(
          (item) =>
            item.name ===
            "legalcode"
        )

      ??

      reverseData.results?.[0];


    if (!regionResult) {

      return NextResponse.json(
        {
          message:
            "현재 위치의 행정구역을 찾지 못했습니다.",
        },
        {
          status: 404,
        }
      );
    }


    const area1 =
      regionResult
        .region
        .area1
        ?.name ?? "";


    const area2 =
      regionResult
        .region
        .area2
        ?.name ?? "";


    const area3 =
      regionResult
        .region
        .area3
        ?.name ?? "";


    /*
     * 화면 표시용 행정구역
     */
    const displayArea =

      [
        area1,
        area2,
        area3,
      ]

        .filter(Boolean)

        .join(" ");


    /*
     * NAVER Local Search용 검색 범위
     *
     * 3~5km는 하나의 동(area3)을 넘어갈 수 있으므로
     * 시/도 + 시/군/구 수준으로 검색합니다.
     */
    const localSearchArea =

      [
        area1,
        area2,
      ]

        .filter(Boolean)

        .join(" ")

      || displayArea;


    /* =====================================================
       4. 추천 메뉴 → NAVER Local Search

       예:
       대전광역시 서구 김치김밥
       대전광역시 서구 농어초밥
       ...
    ===================================================== */

    const collected =
      new Map<
        string,
        {
          item:
            NaverLocalItem;

          matchedTerms:
            Map<
              string,
              number
            >;
        }
      >();


    let successfulSearches =
      0;


    for (
      const searchTerm
      of searchTerms
    ) {

      const query =
        `${localSearchArea} ${searchTerm.name}`;


      const searchUrl =

        "https://naverapihub.apigw.ntruss.com/search/v1/local"

        +

        `?query=${encodeURIComponent(
          query
        )}`

        +

        "&display=5"

        +

        "&start=1"

        +

        "&sort=comment"

        +

        "&format=json";


      const localResponse =
        await fetch(
          searchUrl,
          {

            method:
              "GET",

            headers: {

              "X-NCP-APIGW-API-KEY-ID":
                searchClientId,

              "X-NCP-APIGW-API-KEY":
                searchClientSecret,
            },

            cache:
              "no-store",

            signal:
              AbortSignal.timeout(
                10_000
              ),
          }
        );


      if (
        !localResponse.ok
      ) {

        console.error(
          "NAVER Local Search failed:",
          searchTerm.name,
          await localResponse.text()
        );

        continue;
      }


      successfulSearches++;


      const localData =
        (
          await localResponse
            .json()
        ) as NaverLocalResponse;


      for (
        const item
        of localData.items ?? []
      ) {

        const cleanTitle =
          stripHtml(
            item.title
          );


        const key =
          `${cleanTitle}|${
            item.roadAddress ||
            item.address
          }`;


        const existing =
          collected.get(
            key
          );


        if (existing) {

          const oldScore =
            existing
              .matchedTerms
              .get(
                searchTerm.sourceMenu
              ) ?? 0;


          existing
            .matchedTerms
            .set(
              searchTerm.sourceMenu,

              Math.max(
                oldScore,
                searchTerm.score
              )
            );

        } else {

          collected.set(
            key,
            {

              item,

              matchedTerms:
                new Map([
                  [
                    searchTerm.sourceMenu,
                    searchTerm.score,
                  ],
                ]),
            }
          );
        }
      }
    }


    if (
      successfulSearches === 0
    ) {

      return NextResponse.json(
        {
          message:
            "음식점 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
        },
        {
          status: 502,
        }
      );
    }


    /* =====================================================
       5. 음식점 점수
    ===================================================== */

    const restaurants:
      Restaurant[] = [];


    for (
      const [
        key,
        value,
      ]
      of collected.entries()
    ) {

      const item =
        value.item;


      const restaurantLongitude =
        parseNaverCoordinate(
          item.mapx,
          "longitude"
        );


      const restaurantLatitude =
        parseNaverCoordinate(
          item.mapy,
          "latitude"
        );


      if (
        !Number.isFinite(
          restaurantLatitude
        ) ||
        !Number.isFinite(
          restaurantLongitude
        )
      ) {

        continue;
      }


      /* ---------------------------------------------------
         거리
      --------------------------------------------------- */

      const distance =
        calculateDistance(

          latitude,

          longitude,

          restaurantLatitude,

          restaurantLongitude
        );


      /*
       * 거리 점수
       *
       * 현재 API 검색 반경을 기준으로 선형 계산합니다.
       *
       * 예: radiusKm = 5
       * 0km   -> 100
       * 2.5km -> 50
       * 5km   -> 0
       *
       * 메뉴선호도 탭에서는 이 점수를 사용하지 않고,
       * 추천 탭의 종합 점수에서만 사용합니다.
       */

      const distanceScore =
        clamp(
          Math.round(
            100 -
            (
              distance /
              radiusMeters
            ) * 100
          ),
          0,
          100
        );


      /* ---------------------------------------------------
         메뉴 선호 점수
      --------------------------------------------------- */

      const matchedEntries =
        Array.from(
          value
            .matchedTerms
            .entries()
        );


      let preferenceScore =
        60;


      if (
        usingAi
      ) {

        const scores =
          matchedEntries.map(
            (
              [
                ,
                score,
              ]
            ) =>
              score
          );


        const maxScore =
          scores.length > 0
            ? Math.max(
                ...scores
              )
            : 0;


        const averageScore =
          scores.length > 0

            ? (
                scores.reduce(
                  (
                    sum,
                    score
                  ) =>
                    sum +
                    score,
                  0
                )
                /
                scores.length
              )

            : 0;


        /*
         * 최고 메뉴 적합도 80%
         * 여러 검색에서 나타난 평균 20%
         */
        const basePreference =

          maxScore * 0.80

          +

          averageScore * 0.20;


        /*
         * 추천 메뉴 여러 개에 걸쳐
         * 검색된 음식점은 약간 보너스
         */
        const multiMenuBonus =
          Math.min(
            10,

            Math.max(
              0,
              scores.length - 1
            ) * 3
          );


        preferenceScore =
          clamp(

            Math.round(
              basePreference +
              multiMenuBonus
            ),

            0,

            100
          );

      } else {

        /*
         * AI embedding이 없는 사용자:
         * 기존 카테고리 방식 유지
         */

        const matchCount =
          matchedEntries.length;


        preferenceScore =
          Math.min(

            100,

            60 +
            Math.max(
              0,
              matchCount - 1
            ) * 20
          );
      }


      /* ---------------------------------------------------
         최종 추천 점수

         현재는 가격 데이터가 없으므로:

         메뉴 취향 70%
         거리      30%

         추후:
         메뉴 + 가격 + 거리
      --------------------------------------------------- */

      const recommendScore =
        Math.round(

          preferenceScore *
          0.70

          +

          distanceScore *
          0.30
        );


      restaurants.push({

        id:
          key,

        name:
          stripHtml(
            item.title
          ),

        category:
          item.category,

        address:
          item.address,

        roadAddress:
          item.roadAddress,

        link:
          item.link,

        latitude:
          restaurantLatitude,

        longitude:
          restaurantLongitude,

        distance,

        matchedPreferences:
          matchedEntries.map(
            (
              [
                name,
              ]
            ) =>
              name
          ),

        preferenceScore,

        distanceScore,

        recommendScore,
      });
    }


    /* =====================================================
       6. 선택 반경 필터

       요청된 radiusKm 안에 있는 음식점만 반환합니다.
       범위 밖 음식점을 fallback으로 다시 넣지 않습니다.
    ===================================================== */

    const finalRestaurants =
      restaurants.filter(
        (restaurant) =>
          restaurant.distance <=
          radiusMeters
      );


    /* =====================================================
       7. 기본 정렬

       API 기본 순서는 종합 추천 점수 순입니다.
       프론트의 메뉴선호도 탭에서는 이 배열 전체를 받아
       preferenceScore 기준으로 다시 정렬합니다.
    ===================================================== */

    finalRestaurants.sort(
      (a, b) =>
        b.recommendScore -
        a.recommendScore
    );


    /* =====================================================
       8. 응답
    ===================================================== */

    return NextResponse.json({

      region: {

        area1,

        area2,

        area3,

        displayName:
          displayArea,
      },


      /*
       * 기존 초기 카테고리
       */
      preferences:
        normalizedPreferences,


      /*
       * 어떤 방식으로 추천했는지
       */
      recommendationMode:

        usingAi

          ? "embedding"

          : "category",


      /*
       * 디버깅 및 향후 UI용
       *
       * 벡터 자체는 절대 클라이언트로 보내지 않음
       */
      recommendedMenus:

        aiResult

          ? aiResult
              .recommendations
              .map(
                (item) => ({

                  name:
                    item.name,

                  family:
                    item.family,

                  score:
                    Number(
                      item.baseScore
                        .toFixed(4)
                    ),

                  anchor:
                    item.bestAnchor,

                  mmrScore:
                    item.mmrScore
                      !== undefined

                      ? Number(
                          item.mmrScore
                            .toFixed(4)
                        )

                      : null,
                })
              )

          : [],


      /*
       * 실제 NAVER 검색에 사용된 메뉴
       */
      searchMenus:

        Array.from(
          new Set(
            searchTerms
              .filter(
                (item) =>
                  item.kind !==
                  "family"
              )
              .map(
                (item) =>
                  item.sourceMenu
              )
          )
        ),


      /*
       * 디버깅용:
       * NAVER에 실제 사용한 검색어
       *
       * 프론트 UI에서는 사용하지 않아도 됩니다.
       */
      naverSearchTerms:

        searchTerms.map(
          (item) => ({
            query:
              item.name,

            sourceMenu:
              item.sourceMenu,

            kind:
              item.kind,
          })
        ),


      /*
       * 실제 서버 검색 반경
       */
      radiusKm,


      message:

        successfulSearches
        < searchTerms.length

          ? "일부 메뉴 검색에 실패했습니다. 잠시 후 다시 검색해주세요."

          : undefined,


      /*
       * 중요:
       * 여기서 recommendScore 기준 Top 15로 자르면
       * 메뉴선호도 탭이 먼 거리의 고선호 음식점을 잃을 수 있습니다.
       *
       * 따라서 반경 안의 후보를 모두 내려주고,
       * 프론트에서 탭별로 정렬/필터링합니다.
       */
      restaurants:
        finalRestaurants,
    });


  } catch (error) {

    console.error(
      "Restaurant API error:",
      error
    );


    return NextResponse.json(
      {
        message:
          "음식점 검색 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}