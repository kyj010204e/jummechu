import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import {
  parseCoordinate,
  parsePreferences,
} from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";

import {
  getRestaurantSearchConfidence,
  getRestaurantSearchConfidenceLabel,
  getRestaurantSearchConfidenceRank,
  getSemanticRestaurantSearchAliases,
  type RestaurantSearchConfidence,
} from "@/lib/restaurant-search-terms";

import {
  attachRestaurantPrices,
  type RestaurantPriceFields,
} from "@/lib/price-resolver";

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

/*
 * 정확 메뉴명과 실제 가게 메뉴 표기가 다른 경우를 위한
 * 의미 별칭 검색 수입니다.
 *
 * 예: 제육덮밥 -> 제육 / 제육볶음 / 제육 백반
 */
const NAVER_ALIAS_SEARCH_COUNT = 8;

const EXCLUDED_NAVER_FAMILIES =
  new Set([
    "기타",
    "밥",

    /*
     * 아래 표현들은 너무 넓어서
     * "국", "볶음"만으로 NAVER 검색 시
     * 관련 없는 식당이 많이 섞입니다.
     */
    "국",
    "볶음",
    "구이",
    "튀김",
    "조림",
    "찜",
    "전",
    "무침",
    "떡",
    "면류",
  ]);


/*
 * 사용자 대표 취향
 * +
 * 개별 실제 메뉴 취향
 */
const PROFILE_WEIGHT = 0.60;
const BEST_ANCHOR_WEIGHT = 0.30;
const MEAN_ANCHOR_WEIGHT = 0.10;

const FAVORITE_ANCHOR_PRIORITY_BONUS = 0.08;
const FAVORITE_BASE_SCORE_BONUS = 0.03;
const FAVORITE_SLOT_RATIO = 0.30;
const FAVORITE_MIN_SIMILARITY = 0.20;

/*
 * 이름이 비슷하다는 이유만으로
 * 감자탕 -> 감자밥 같은 후보가 최애 슬롯을 차지하지 않도록
 * 음식 Family 적합도를 함께 사용합니다.
 */
const ANCHOR_FAMILY_PRIORITY_BONUS = 0.08;
const ANCHOR_FAMILY_BASE_BONUS = 0.04;
const FAVORITE_MIN_FAMILY_AFFINITY = 0.55;

/*
 * NAVER 검색 결과와 추천 메뉴의 업종 적합도.
 * 너무 동떨어진 결과는 matchedPreferences에 넣지 않습니다.
 */
const MIN_NAVER_MATCH_RELEVANCE = 0.60;


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

type RestaurantVenueType =
  | "restaurant"
  | "bar";


type RestaurantCore = {
  id: string;

  name: string;

  category: string;

  venueType:
    RestaurantVenueType;

  venueTypeLabel:
    "음식점" | "술집";

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
   * 이 음식점과 가장 강하게 연결된 추천 메뉴.
   *
   * NAVER 검색에 사용된 sourceMenu 중
   * adjustedSearchScore가 가장 높은 메뉴를 선택합니다.
   */
  recommendedMenuName:
    string | null;

  recommendedMenuScore:
    number | null;

  /*
   * 이 식당을 어떤 수준의 검색어로 발견했는지 표시합니다.
   * exact: 추천 메뉴명 자체로 검색
   * alias: 수육/돈까스처럼 정규화된 유사 메뉴명으로 검색
   * broad: family/category 같은 넓은 계열 검색
   */
  menuMatchConfidence:
    RestaurantSearchConfidence | null;

  menuMatchConfidenceLabel:
    string | null;

  menuMatchSearchTerm:
    string | null;

  /*
   * AI 메뉴 취향 점수
   */
  preferenceScore: number;

  /*
   * 거리 점수
   */
  distanceScore: number;

  /*
   * 가격 데이터 연결 전 기본 추천 점수.
   *
   * 가격 비교가 가능하면 price-resolver에서
   * 메뉴 + 가격 + 거리 점수로 다시 계산합니다.
   */
  recommendScore: number;
};


type Restaurant =
  RestaurantCore &
  RestaurantPriceFields & {

    /*
     * 현재 영업 상태
     *
     * NAVER 지역검색 API 자체에는 영업시간 필드가 없으므로
     * restaurant_business_hours 테이블의 검증된 데이터를 사용합니다.
     */
    businessHours:
      BusinessHoursInfo;

    /*
     * 추천 목록에 포함 가능한지 여부.
     *
     * OPEN / UNKNOWN  -> true
     * BREAK / CLOSED / CLOSED_TODAY -> false
     */
    recommendationEligible:
      boolean;
  };


/* =========================================================
   영업시간 타입
========================================================= */

type BusinessStatus =
  | "OPEN"
  | "BREAK"
  | "CLOSED"
  | "CLOSED_TODAY"
  | "UNKNOWN";


type BusinessHoursInfo = {
  status: BusinessStatus;

  label: string;

  detail: string | null;

  todayOpen: string | null;
  todayClose: string | null;

  breakStart: string | null;
  breakEnd: string | null;

  nextOpenText: string | null;

  source: string | null;

  verifiedAt: string | null;
};


type RawBusinessHoursRow = {
  restaurant_key: string;

  day_of_week: number;

  open_time: string | null;
  close_time: string | null;

  break_start_time:
    string | null;

  break_end_time:
    string | null;

  is_closed: boolean;

  source: string | null;

  verified_at:
    Date | string | null;
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
  | "favorite"
  | "menu"
  | "alias"
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

type SearchMatchEvidence = {
  score: number;
  confidence: RestaurantSearchConfidence;
  query: string;
  kind: SearchTermKind;
};

function mergeSearchMatchEvidence(
  current: SearchMatchEvidence | undefined,
  searchTerm: SearchTerm,
  score: number
): SearchMatchEvidence {
  const confidence =
    getRestaurantSearchConfidence(
      searchTerm.kind
    );

  if (!current) {
    return {
      score,
      confidence,
      query: searchTerm.name,
      kind: searchTerm.kind,
    };
  }

  const nextRank =
    getRestaurantSearchConfidenceRank(
      confidence
    );

  const currentRank =
    getRestaurantSearchConfidenceRank(
      current.confidence
    );

  const replaceDescriptor =
    nextRank > currentRank ||
    (
      nextRank === currentRank &&
      score > current.score
    );

  return {
    score: Math.max(
      current.score,
      score
    ),
    confidence:
      replaceDescriptor
        ? confidence
        : current.confidence,
    query:
      replaceDescriptor
        ? searchTerm.name
        : current.query,
    kind:
      replaceDescriptor
        ? searchTerm.kind
        : current.kind,
  };
}


/* =========================================================
   기존 카테고리 fallback
========================================================= */

const PREFERENCE_KEYWORDS:
  Record<string, string> = {

  korean: "한식",

  rice: "밥",
  soup: "찌개",
  snack: "분식",
  western: "양식",

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
   NAVER 업종 필터
========================================================= */

const BLOCKED_NAVER_CATEGORY_KEYWORDS = [
  "쇼핑",
  "유통",
  "슈퍼",
  "마트",
  "편의점",
  "제조업",
  "식품제조",
  "도매",
  "소매",
  "노래방",
  "숙박",
];


const BAR_NAVER_CATEGORY_KEYWORDS = [
  "주점",
  "술집",
  "요리주점",
  "이자카야",
  "호프",
  "맥주",
  "펍",
  "pub",
  "와인바",
  "칵테일바",
  "포장마차",
  "실내포장마차",
  "포차",
  "바(bar)",
  "bar",
];


function isBarNaverItem(
  item: NaverLocalItem
) {
  const category =
    stripHtml(
      item.category ?? ""
    ).toLowerCase();

  if (
    includesAny(
      category,
      BAR_NAVER_CATEGORY_KEYWORDS
    )
  ) {
    return true;
  }

  /*
   * 단순 "바" 한 글자는
   * 바른..., 바다... 같은 오탐이 많아서
   * 상호명 보조 판정에는 사용하지 않습니다.
   */
  const title =
    stripHtml(
      item.title ?? ""
    ).toLowerCase();

  return includesAny(
    title,
    [
      "이자카야",
      "와인바",
      "칵테일바",
      "포차",
      "호프",
      "펍",
      "pub",
    ]
  );
}


function getRestaurantVenueType(
  item: NaverLocalItem
): RestaurantVenueType {
  return isBarNaverItem(
    item
  )
    ? "bar"
    : "restaurant";
}


const FOOD_NAVER_CATEGORY_KEYWORDS = [
  "음식점",
  "음식",
  "요리",
  "한식",
  "일식",
  "중식",
  "양식",
  "분식",
  "국밥",
  "냉면",
  "칼국수",
  "만두",
  "라면",
  "돈가스",
  "초밥",
  "롤",
  "고기",
  "갈비",
  "곱창",
  "족발",
  "보쌈",
  "치킨",
  "피자",
  "햄버거",
  "샌드위치",
  "베트남",
  "태국",
  "인도",
  "멕시코",
  "이탈리아",
  "아시아",
  "죽",
  "도시락",
  "카페",
  "디저트",
  "베이커리",
  "제과",
];


const CAFE_NAVER_CATEGORY_KEYWORDS = [
  "카페",
  "디저트",
  "베이커리",
  "제과",
];


const CAFE_FRIENDLY_MENU_KEYWORDS = [
  "카페",
  "커피",
  "디저트",
  "베이커리",
  "빵",
  "케이크",
  "쿠키",
  "도넛",
  "와플",
  "마카롱",
  "아이스크림",
  "빙수",
  "약과",
  "인절미",
  "찹쌀떡",
  "송편",
  "떡",
];


function includesAny(
  value: string,
  keywords: string[]
) {

  return keywords.some(
    (keyword) =>
      value.includes(
        keyword
      )
  );
}


function inferNaverCategoryGroups(
  category: string
) {

  const groups =
    new Set<string>();


  if (
    includesAny(
      category,
      [
        "라면",
        "냉면",
        "칼국수",
        "국수",
        "우동",
        "짬뽕",
        "짜장",
        "자장",
        "면",
      ]
    )
  ) {
    groups.add(
      "noodle"
    );
  }


  if (
    includesAny(
      category,
      [
        "국밥",
        "해장국",
        "설렁탕",
        "곰탕",
        "찌개",
        "탕",
        "전골",
      ]
    )
  ) {
    groups.add(
      "soup"
    );
  }


  if (
    includesAny(
      category,
      [
        "돈가스",
        "돈까스",
        "튀김",
        "치킨",
      ]
    )
  ) {
    groups.add(
      "fried"
    );
  }


  if (
    includesAny(
      category,
      [
        "육류",
        "고기",
        "갈비",
        "곱창",
        "삼겹살",
        "구이",
        "족발",
        "보쌈",
        "찜닭",
        "닭갈비",
        "닭발",
        "수육",
        "뭉티기",
        "육회",
      ]
    )
  ) {
    groups.add(
      "meat"
    );
  }


  if (
    includesAny(
      category,
      [
        "해물",
        "생선",
        "주꾸미",
        "쭈꾸미",
        "낙지",
        "오징어",
        "아구",
        "아귀",
        "장어",
      ]
    )
  ) {
    groups.add(
      "seafood"
    );
  }


  if (
    includesAny(
      category,
      [
        "초밥",
        "롤",
        "사시미",
        "회",
      ]
    )
  ) {
    groups.add(
      "sushi"
    );
  }


  if (
    includesAny(
      category,
      [
        "김밥",
        "덮밥",
        "볶음밥",
        "비빔밥",
        "도시락",
      ]
    )
  ) {
    groups.add(
      "rice"
    );
  }


  if (
    includesAny(
      category,
      [
        "분식",
        "떡볶이",
      ]
    )
  ) {
    groups.add(
      "snack"
    );
  }


  return groups;
}


function getNaverMenuCategoryRelevance(
  item: NaverLocalItem,
  searchTerm: SearchTerm
) {

  const category =
    stripHtml(
      item.category ?? ""
    );


  const title =
    stripHtml(
      item.title ?? ""
    );


  const sourceFamily =
    getFoodFamily(
      searchTerm.sourceMenu,
      null
    );


  const sourceGroup =
    getFamilyGroup(
      sourceFamily
    );


  const categoryGroups =
    inferNaverCategoryGroups(
      category
    );


  const titleGroups =
    inferNaverCategoryGroups(
      title
    );


  /*
   * 제목/업종에 Family가 직접 들어가면 가장 강한 신호.
   */
  if (
    sourceFamily !== "기타" &&
    (
      title.includes(
        sourceFamily
      ) ||
      category.includes(
        sourceFamily
      )
    )
  ) {
    return 1.0;
  }


  if (
    categoryGroups.has(
      sourceGroup
    ) ||
    titleGroups.has(
      sourceGroup
    )
  ) {
    return 0.95;
  }


  /*
   * 가게 이름 자체가 특정 메뉴 전문점인데
   * 추천 메뉴군과 전혀 다르면 검색 노이즈일 가능성이 높습니다.
   *
   * 예:
   * 물냉면 -> 백선당찜닭
   * 불고기덮밥 -> 상무초밥
   * 볶음밥 -> 떡볶이농장
   */
  if (
    titleGroups.size > 0
  ) {
    return 0.45;
  }


  /*
   * 전문 업종 정보가 있는데 추천 메뉴군과 다르면
   * broad cuisine(한식/일식/중식)보다 이 정보를 우선합니다.
   *
   * 예:
   * 짬뽕라면 -> 한식>육류,고기요리
   * 볶음우동 -> 일식>돈가스
   * 감자국   -> 한식>칼국수,만두
   *
   * 기존에는 "한식/일식"이라는 이유로 통과했지만,
   * 이제 전문 업종 mismatch면 여기서 낮은 점수를 줍니다.
   */
  if (
    categoryGroups.size > 0
  ) {
    return 0.45;
  }


  /*
   * 넓은 음식 업종은 실제로 여러 메뉴를 판매할 수 있으므로
   * 적당한 relevance를 줍니다.
   */
  if (
    category.includes(
      "한식"
    )
  ) {

    if (
      [
        "rice",
        "soup",
        "meat",
        "noodle",
        "snack",
      ].includes(
        sourceGroup
      )
    ) {
      return 0.82;
    }

    return 0.68;
  }


  if (
    category.includes(
      "일식"
    )
  ) {

    if (
      [
        "rice",
        "noodle",
        "fried",
        "sushi",
      ].includes(
        sourceGroup
      )
    ) {
      return 0.85;
    }

    return 0.62;
  }


  if (
    category.includes(
      "중식"
    )
  ) {

    if (
      [
        "rice",
        "noodle",
        "meat",
      ].includes(
        sourceGroup
      )
    ) {
      return 0.88;
    }

    return 0.60;
  }


  if (
    category.includes(
      "분식"
    )
  ) {

    if (
      [
        "rice",
        "noodle",
        "fried",
        "snack",
      ].includes(
        sourceGroup
      )
    ) {
      return 0.88;
    }

    return 0.60;
  }


  if (
    includesAny(
      category,
      [
        "멕시코",
        "남미",
        "인도",
        "태국",
        "베트남",
        "이탈리아",
        "피자",
        "햄버거",
      ]
    )
  ) {
    return 0.50;
  }


  /*
   * 단순 "음식점>..." 정도만 있는 경우는
   * NAVER 검색 결과 자체의 신호를 어느 정도 신뢰.
   */
  if (
    category.includes(
      "음식점"
    ) ||
    category.includes(
      "음식"
    ) ||
    category.includes(
      "요리"
    )
  ) {
    return 0.72;
  }


  return 0.55;
}


function isRelevantNaverResult(
  item: NaverLocalItem,
  searchTerm: SearchTerm
) {

  const category =
    stripHtml(
      item.category ?? ""
    );


  if (
    includesAny(
      category,
      BLOCKED_NAVER_CATEGORY_KEYWORDS
    )
  ) {

    return false;
  }


  const isBarCategory =
    isBarNaverItem(
      item
    );


  if (
    !isBarCategory &&
    !includesAny(
      category,
      FOOD_NAVER_CATEGORY_KEYWORDS
    )
  ) {

    return false;
  }


  const isCafeCategory =
    includesAny(
      category,
      CAFE_NAVER_CATEGORY_KEYWORDS
    );


  if (
    isCafeCategory
  ) {

    const searchContext =
      `${searchTerm.name} ${searchTerm.sourceMenu}`;


    if (
      !includesAny(
        searchContext,
        CAFE_FRIENDLY_MENU_KEYWORDS
      )
    ) {

      return false;
    }
  }


  return true;
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


  /*
   * 치킨가스/생선가스도 "가스류"로 묶어야
   * 돈가스 최애와 자연스럽게 연결됩니다.
   *
   * 반드시 일반 치킨 판정보다 먼저 검사합니다.
   */
  if (
    name.includes("돈가스") ||
    name.includes("돈까스") ||
    name.includes("치킨가스") ||
    name.includes("치킨까스") ||
    name.includes("생선가스") ||
    name.includes("생선까스")
  ) {

    return "돈가스";
  }


  if (
    name.includes("치킨") ||
    name.includes("닭튀김")
  ) {

    return "치킨";
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
    name.includes("갈비찜") ||
    name.includes("수육") ||
    name.includes("보쌈") ||
    name.includes("족발")
  ) {

    return "찜";
  }


  if (
    name.includes("불고기") ||
    name.includes("갈비")
  ) {

    return "구이";
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
   Food Family 적합도

   완전히 같은 Family는 1.0,
   같은 큰 음식군은 0.55~0.88,
   관련성이 낮으면 0.0으로 봅니다.

   예:
   감자탕(탕) -> 갈비탕(탕)     1.00
   감자탕(탕) -> 국밥           0.88
   감자탕(탕) -> 감자밥(밥)     0.00

   돈가스 -> 생선가스/치킨가스  높은 점수
   제육덮밥 -> 불고기덮밥       1.00
========================================================= */

function getFamilyGroup(
  family: string
) {

  if (
    [
      "볶음밥",
      "비빔밥",
      "덮밥",
      "밥",
      "김밥",
    ].includes(
      family
    )
  ) {
    return "rice";
  }


  if (
    [
      "라면",
      "냉면",
      "우동",
      "칼국수",
      "면류",
      "국수",
    ].includes(
      family
    )
  ) {
    return "noodle";
  }


  if (
    [
      "찌개",
      "전골",
      "국",
      "탕",
      "국밥",
    ].includes(
      family
    )
  ) {
    return "soup";
  }


  if (
    [
      "돈가스",
      "튀김",
      "치킨",
    ].includes(
      family
    )
  ) {
    return "fried";
  }


  if (
    [
      "구이",
      "볶음",
      "조림",
      "찜",
    ].includes(
      family
    )
  ) {
    return "meat";
  }


  if (
    family === "초밥"
  ) {
    return "sushi";
  }


  if (
    [
      "떡",
      "전",
      "무침",
    ].includes(
      family
    )
  ) {
    return "snack";
  }


  return "other";
}


function getFamilyAffinity(
  anchorFamily: string,
  candidateFamily: string
) {

  if (
    anchorFamily ===
    candidateFamily
  ) {
    return 1.0;
  }


  const anchorGroup =
    getFamilyGroup(
      anchorFamily
    );

  const candidateGroup =
    getFamilyGroup(
      candidateFamily
    );


  if (
    anchorGroup ===
      "other" ||
    candidateGroup ===
      "other"
  ) {
    return 0;
  }


  if (
    anchorGroup ===
    candidateGroup
  ) {

    /*
     * 밥류는 이름만 같은 "밥"이라고 해서
     * 식사 경험이 모두 비슷하지 않습니다.
     *
     * 특히 제육덮밥 -> 쌀밥 같은 추천은
     * 최애 슬롯에 들어오지 않도록 낮게 둡니다.
     */
    if (
      anchorGroup ===
      "rice"
    ) {

      const pair =
        new Set([
          anchorFamily,
          candidateFamily,
        ]);


      if (
        pair.has(
          "덮밥"
        ) &&
        pair.has(
          "볶음밥"
        )
      ) {
        return 0.68;
      }


      if (
        pair.has(
          "덮밥"
        ) &&
        pair.has(
          "비빔밥"
        )
      ) {
        return 0.65;
      }


      if (
        pair.has(
          "볶음밥"
        ) &&
        pair.has(
          "비빔밥"
        )
      ) {
        return 0.62;
      }


      if (
        pair.has(
          "밥"
        )
      ) {
        return 0.30;
      }


      if (
        pair.has(
          "김밥"
        )
      ) {
        return 0.35;
      }


      return 0.55;
    }


    switch (
      anchorGroup
    ) {

      case "soup":
        return 0.88;

      case "noodle":
        return 0.85;

      case "fried":

        if (
          (
            anchorFamily === "돈가스" &&
            candidateFamily === "치킨"
          ) ||
          (
            anchorFamily === "치킨" &&
            candidateFamily === "돈가스"
          )
        ) {
          return 0.45;
        }

        return 0.78;

      case "meat":
        return 0.62;

      case "snack":
        return 0.60;

      default:
        return 0.55;
    }
  }


  /*
   * 국밥은 밥 이름이지만 실제 식사 경험은
   * 국/탕 계열과도 매우 가깝습니다.
   */
  if (
    (
      anchorFamily === "국밥" &&
      candidateGroup === "rice"
    ) ||
    (
      candidateFamily === "국밥" &&
      anchorGroup === "rice"
    )
  ) {
    return 0.35;
  }


  /*
   * 덮밥과 볶음밥은 같은 한 그릇 식사 계열이지만
   * 완전히 같은 Family보다는 낮게 둡니다.
   */
  if (
    (
      anchorFamily === "덮밥" &&
      candidateFamily === "볶음밥"
    ) ||
    (
      anchorFamily === "볶음밥" &&
      candidateFamily === "덮밥"
    )
  ) {
    return 0.68;
  }


  /*
   * 돈가스/튀김과 일부 치킨류
   */
  if (
    (
      anchorGroup === "fried" &&
      candidateGroup === "meat"
    ) ||
    (
      anchorGroup === "meat" &&
      candidateGroup === "fried"
    )
  ) {
    return 0.25;
  }


  return 0;
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


    let favoriteAnchorBoost =
      0;


    if (
      anchors.length > 0
    ) {

      const anchorScores =
        anchors.map(
          (anchor) => {

            const similarity =
              dotProduct(
                anchor.vector,
                foodVector
              );


            const anchorFamily =
              getFoodFamily(
                anchor.name,
                null
              );


            const candidateFamily =
              getFoodFamily(
                food.name,
                food.foodType
              );


            const familyAffinity =
              getFamilyAffinity(
                anchorFamily,
                candidateFamily
              );


            const priorityScore =

              similarity

              +

              familyAffinity *
              ANCHOR_FAMILY_PRIORITY_BONUS

              +

              Math.max(
                0,
                anchor.weight - 1
              ) *
              FAVORITE_ANCHOR_PRIORITY_BONUS *
              familyAffinity;


            return {
              name:
                anchor.name,

              weight:
                anchor.weight,

              similarity,

              familyAffinity,

              priorityScore,
            };
          }
        );


      const sorted =
        [...anchorScores].sort(
          (a, b) =>
            b.priorityScore -
            a.priorityScore
        );


      bestAnchor =
        sorted[0].name;

      bestAnchorSimilarity =
        sorted[0].similarity;


      const totalAnchorWeight =
        anchorScores.reduce(
          (
            sum,
            item
          ) =>
            sum +
            Math.max(
              1,
              item.weight
            ),
          0
        );


      meanAnchorSimilarity =
        totalAnchorWeight > 0

          ? anchorScores.reduce(
              (
                sum,
                item
              ) =>
                sum +
                item.similarity *
                Math.max(
                  1,
                  item.weight
                ),
              0
            ) /
            totalAnchorWeight

          : profileSimilarity;


      favoriteAnchorBoost =

        Math.max(
          0,
          sorted[0].weight - 1
        ) *
        FAVORITE_BASE_SCORE_BONUS *
        sorted[0].familyAffinity

        +

        sorted[0].familyAffinity *
        ANCHOR_FAMILY_BASE_BONUS;
    }


    const baseScore =

      PROFILE_WEIGHT *
      profileSimilarity

      +

      BEST_ANCHOR_WEIGHT *
      bestAnchorSimilarity

      +

      MEAN_ANCHOR_WEIGHT *
      meanAnchorSimilarity

      +

      favoriteAnchorBoost;


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
     최애 메뉴 기반 슬롯 우선 확보

     모든 선호 메뉴를 순서대로 하나씩 선점하지 않고,
     weight > 1인 최애 메뉴만 먼저 일부 슬롯을 확보합니다.
     나머지는 아래 MMR에서 전체 취향 + 다양성으로 결정합니다.
  ------------------------------------------------------- */

  const favoriteAnchors =
    [...anchors]
      .filter(
        (anchor) =>
          anchor.weight > 1
      )
      .sort(
        (a, b) =>
          b.weight -
          a.weight
      );


  const favoriteSlotLimit =
    favoriteAnchors.length > 0

      ? Math.min(
          topK,

          Math.max(
            favoriteAnchors.length,

            Math.ceil(
              topK *
              FAVORITE_SLOT_RATIO
            )
          )
        )

      : 0;


  let favoriteRound =
    0;


  while (
    favoriteAnchors.length > 0 &&
    results.length <
      favoriteSlotLimit
  ) {

    let addedThisRound =
      false;


    for (
      const anchor
      of favoriteAnchors
    ) {

      if (
        results.length >=
        favoriteSlotLimit
      ) {

        break;
      }


      const anchorFamily =
        getFoodFamily(
          anchor.name,
          null
        );


      const available =
        remaining
          .map(
            (candidate) => {

              const similarity =
                dotProduct(
                  anchor.vector,
                  candidate.vector
                );


              const familyAffinity =
                getFamilyAffinity(
                  anchorFamily,
                  candidate.family
                );


              return {
                candidate,
                similarity,
                familyAffinity,
              };
            }
          )
          .filter(
            (item) => {

              const familyCount =
                familyCounts.get(
                  item.candidate.family
                ) ?? 0;


              return (
                familyCount <
                  MAX_PER_FAMILY &&

                item.similarity >=
                  FAVORITE_MIN_SIMILARITY &&

                item.familyAffinity >=
                  FAVORITE_MIN_FAMILY_AFFINITY
              );
            }
          )
          .sort(
            (a, b) => {

              const scoreA =
                a.similarity *
                  0.55 +
                a.familyAffinity *
                  0.30 +
                a.candidate.baseScore *
                  0.15;


              const scoreB =
                b.similarity *
                  0.55 +
                b.familyAffinity *
                  0.30 +
                b.candidate.baseScore *
                  0.15;


              return (
                scoreB -
                scoreA
              );
            }
          );


      if (
        available.length === 0
      ) {

        continue;
      }


      const chosen =
        available[0];


      const selected:
        RecommendationCandidate = {

        ...chosen.candidate,

        bestAnchor:
          anchor.name,

        anchorSimilarity:
          chosen.similarity,

        mmrScore:
          chosen.candidate
            .baseScore,
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
            item.id !==
            selected.id
        );


      addedThisRound =
        true;
    }


    if (
      !addedThisRound
    ) {

      break;
    }


    favoriteRound++;


    if (
      favoriteRound >
      topK
    ) {

      break;
    }
  }


  const maxPerAnchor =
    anchors.length > 0

      ? Math.max(
          2,

          Math.ceil(
            topK /
            Math.min(
              anchors.length,
              topK
            )
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
    RecommendationCandidate[],

  selectedFoods:
    SelectedFood[]
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


  /*
   * 정확 메뉴 검색 총량은 기존과 동일하게
   * 최대 NAVER_SEARCH_MENU_COUNT개로 유지합니다.
   *
   * 즉:
   * 최애 3개 + AI 추천 5개 = 총 8개
   *
   * 외부 NAVER 요청 수를 늘리지 않으면서
   * 사용자가 직접 ♥ 표시한 메뉴를 가장 먼저 검색합니다.
   */
  let exactSearchCount =
    0;


  /* -------------------------------------------------------
     1. ♥ 최애 메뉴 직접 검색

     추천 후보 생성에서는 이미 선택한 음식 자체를 제외하지만,
     "음식점 추천"에서는 사용자가 좋아한다고 직접 표시한
     메뉴를 파는 식당도 반드시 후보가 되어야 합니다.

     예:
     ♥ 감자탕 -> 주변 감자탕집 직접 검색
     ♥ 돈가스 -> 주변 돈가스집 직접 검색
     ♥ 제육덮밥 -> 주변 제육덮밥집 직접 검색
  ------------------------------------------------------- */

  const favoriteFoods =
    [...selectedFoods]
      .filter(
        (food) =>
          food.weight > 1
      )
      .sort(
        (a, b) =>
          b.weight -
          a.weight
      );


  for (
    const food
    of favoriteFoods
  ) {

    const query =
      food.name.trim();


    if (
      !query ||
      seenQueries.has(
        query
      )
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
        food.name,

      /*
       * 사용자가 직접 최애로 지정한 메뉴이므로
       * 가장 높은 취향 신호로 취급합니다.
       */
      score:
        100,

      kind:
        "favorite",
    });


    exactSearchCount++;


    if (
      exactSearchCount >=
      NAVER_SEARCH_MENU_COUNT
    ) {

      break;
    }
  }


  /* -------------------------------------------------------
     2. 정확한 AI 추천 메뉴

     최애 검색 후 남은 슬롯만 사용합니다.
     예: 최애 3개면 AI 추천 메뉴는 최대 5개.
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


    exactSearchCount++;


    if (
      exactSearchCount >=
      NAVER_SEARCH_MENU_COUNT
    ) {

      break;
    }
  }


  /* -------------------------------------------------------
     3. 의미 별칭 확장 검색

     추천 메뉴명과 실제 음식점 메뉴 표기가 다를 때
     후보군에서 매장이 통째로 누락되는 문제를 줄입니다.

     예:
     제육덮밥 -> 제육 / 제육볶음 / 제육 백반
     불고기덮밥 -> 불고기
     오징어덮밥 -> 오징어 / 오징어볶음

     정확 메뉴보다 신뢰도는 조금 낮게 주고,
     최종적으로 실제 거리 점수와 함께 다시 정렬합니다.
  ------------------------------------------------------- */

  let aliasCount = 0;

  const aliasSeeds = [
    ...favoriteFoods.map(
      (food) => ({
        name: food.name,
        sourceMenu: food.name,
        score: 100,
      })
    ),

    ...recommendations.map(
      (item) => ({
        name: item.name,
        sourceMenu: item.name,
        score: scoreToPercent(
          item.baseScore
        ),
      })
    ),
  ];


  /*
   * 특정 상위 메뉴 하나가 alias 슬롯을 모두 차지하지 않도록
   * 메뉴별 검색어를 round-robin으로 배치합니다.
   *
   * getSemanticRestaurantSearchAliases()의 첫 번째 값은
   * "돼지고기수육 -> 수육", "치즈돈가스 -> 돈가스"처럼
   * 실제 음식점 검색에 더 잘 잡히는 대표 메뉴명입니다.
   */
  const aliasGroups =
    aliasSeeds.map(
      (seed) => ({
        seed,
        aliases:
          getSemanticRestaurantSearchAliases(
            seed.name
          ),
      })
    );


  const maxAliasDepth =
    aliasGroups.reduce(
      (max, group) =>
        Math.max(
          max,
          group.aliases.length
        ),
      0
    );


  for (
    let aliasIndex = 0;
    aliasIndex < maxAliasDepth &&
    aliasCount < NAVER_ALIAS_SEARCH_COUNT;
    aliasIndex++
  ) {

    for (
      const group
      of aliasGroups
    ) {

      const alias =
        group.aliases[
          aliasIndex
        ];


      if (
        !alias ||
        seenQueries.has(
          alias
        )
      ) {
        continue;
      }


      seenQueries.add(
        alias
      );


      result.push({
        name:
          alias,

        sourceMenu:
          group.seed.sourceMenu,

        score:
          clamp(
            group.seed.score - 4,
            0,
            100
          ),

        kind:
          "alias",
      });


      aliasCount++;


      if (
        aliasCount >=
        NAVER_ALIAS_SEARCH_COUNT
      ) {
        break;
      }
    }
  }


  /* -------------------------------------------------------
     4. 메뉴 family 확장 검색

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
   영업시간 계산
========================================================= */

const KOREA_TIME_ZONE =
  "Asia/Seoul";


function getKoreaDayAndMinutes(
  now = new Date()
) {

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          KOREA_TIME_ZONE,

        weekday:
          "short",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23",
      }
    ).formatToParts(
      now
    );


  const weekday =
    parts.find(
      (part) =>
        part.type ===
        "weekday"
    )?.value ?? "Sun";


  const hour =
    Number(
      parts.find(
        (part) =>
          part.type ===
          "hour"
      )?.value ?? "0"
    );


  const minute =
    Number(
      parts.find(
        (part) =>
          part.type ===
          "minute"
      )?.value ?? "0"
    );


  const dayMap:
    Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };


  return {
    dayOfWeek:
      dayMap[
        weekday
      ] ?? 0,

    minutes:
      hour * 60 +
      minute,
  };
}


function parseClockMinutes(
  value: string | null
) {

  if (!value) {
    return null;
  }


  const [
    hourText,
    minuteText,
  ] =
    value
      .slice(
        0,
        5
      )
      .split(":");


  const hour =
    Number(
      hourText
    );

  const minute =
    Number(
      minuteText
    );


  if (
    !Number.isFinite(
      hour
    ) ||
    !Number.isFinite(
      minute
    )
  ) {

    return null;
  }


  return (
    hour * 60 +
    minute
  );
}


function isWithinTimeRange(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number
) {

  /*
   * 11:00 ~ 22:00
   */
  if (
    endMinutes >
    startMinutes
  ) {

    return (
      currentMinutes >=
        startMinutes &&
      currentMinutes <
        endMinutes
    );
  }


  /*
   * 18:00 ~ 02:00 같은 익일 영업
   */
  if (
    endMinutes <
    startMinutes
  ) {

    return (
      currentMinutes >=
        startMinutes ||
      currentMinutes <
        endMinutes
    );
  }


  /*
   * start === end는
   * 24시간 영업으로 취급합니다.
   */
  return true;
}


function unknownBusinessHours():
  BusinessHoursInfo {

  return {
    status:
      "UNKNOWN",

    label:
      "영업시간 정보 없음",

    detail:
      null,

    todayOpen:
      null,

    todayClose:
      null,

    breakStart:
      null,

    breakEnd:
      null,

    nextOpenText:
      null,

    source:
      null,

    verifiedAt:
      null,
  };
}


function makeBusinessHoursInfo(
  row: RawBusinessHoursRow | undefined,
  currentMinutes: number
):
  BusinessHoursInfo {

  if (!row) {
    return unknownBusinessHours();
  }


  const verifiedAt =
    row.verified_at

      ? new Date(
          row.verified_at
        ).toISOString()

      : null;


  if (
    row.is_closed
  ) {

    return {
      status:
        "CLOSED_TODAY",

      label:
        "오늘 휴무",

      detail:
        "오늘은 운영하지 않아요",

      todayOpen:
        null,

      todayClose:
        null,

      breakStart:
        null,

      breakEnd:
        null,

      nextOpenText:
        null,

      source:
        row.source,

      verifiedAt,
    };
  }


  const openMinutes =
    parseClockMinutes(
      row.open_time
    );

  const closeMinutes =
    parseClockMinutes(
      row.close_time
    );


  if (
    openMinutes === null ||
    closeMinutes === null
  ) {

    return unknownBusinessHours();
  }


  const breakStartMinutes =
    parseClockMinutes(
      row.break_start_time
    );

  const breakEndMinutes =
    parseClockMinutes(
      row.break_end_time
    );


  if (
    breakStartMinutes !== null &&
    breakEndMinutes !== null &&
    isWithinTimeRange(
      currentMinutes,
      breakStartMinutes,
      breakEndMinutes
    )
  ) {

    return {
      status:
        "BREAK",

      label:
        "브레이크타임",

      detail:
        `${row.break_start_time} ~ ${row.break_end_time}`,

      todayOpen:
        row.open_time,

      todayClose:
        row.close_time,

      breakStart:
        row.break_start_time,

      breakEnd:
        row.break_end_time,

      nextOpenText:
        `${row.break_end_time}부터 영업`,

      source:
        row.source,

      verifiedAt,
    };
  }


  const isOpen =
    isWithinTimeRange(
      currentMinutes,
      openMinutes,
      closeMinutes
    );


  if (
    isOpen
  ) {

    return {
      status:
        "OPEN",

      label:
        "영업중",

      detail:
        `${row.open_time} ~ ${row.close_time}`,

      todayOpen:
        row.open_time,

      todayClose:
        row.close_time,

      breakStart:
        row.break_start_time,

      breakEnd:
        row.break_end_time,

      nextOpenText:
        null,

      source:
        row.source,

      verifiedAt,
    };
  }


  /*
   * 아직 오늘 영업 시작 전인지,
   * 영업이 끝난 뒤인지 구분합니다.
   *
   * 익일 영업(예: 18:00~02:00)은
   * 위 isWithinTimeRange에서 이미 처리됩니다.
   */
  const beforeOpen =
    closeMinutes >
      openMinutes &&
    currentMinutes <
      openMinutes;


  return {
    status:
      "CLOSED",

    label:
      beforeOpen
        ? "영업 전"
        : "영업종료",

    detail:
      `${row.open_time} ~ ${row.close_time} 운영`,

    todayOpen:
      row.open_time,

    todayClose:
      row.close_time,

    breakStart:
      row.break_start_time,

    breakEnd:
      row.break_end_time,

    nextOpenText:
      beforeOpen
        ? `${row.open_time}부터 영업`
        : null,

    source:
      row.source,

    verifiedAt,
  };
}


async function attachBusinessHours(
  restaurants:
    Array<
      RestaurantCore &
      RestaurantPriceFields
    >
) {

  if (
    restaurants.length === 0
  ) {

    return [] as Restaurant[];
  }


  const {
    dayOfWeek,
    minutes:
      currentMinutes,
  } =
    getKoreaDayAndMinutes();


  const restaurantKeys =
    restaurants.map(
      (restaurant) =>
        restaurant.id
    );


  let rows:
    RawBusinessHoursRow[] = [];


  try {

    const keysJson =
      JSON.stringify(
        restaurantKeys
      );


    rows =
      await prisma.$queryRaw<
        RawBusinessHoursRow[]
      >`
        SELECT
          rbh.restaurant_key,

          rbh.day_of_week,

          CASE
            WHEN rbh.open_time
              IS NULL
            THEN NULL
            ELSE to_char(
              rbh.open_time,
              'HH24:MI'
            )
          END
            AS open_time,

          CASE
            WHEN rbh.close_time
              IS NULL
            THEN NULL
            ELSE to_char(
              rbh.close_time,
              'HH24:MI'
            )
          END
            AS close_time,

          CASE
            WHEN rbh.break_start_time
              IS NULL
            THEN NULL
            ELSE to_char(
              rbh.break_start_time,
              'HH24:MI'
            )
          END
            AS break_start_time,

          CASE
            WHEN rbh.break_end_time
              IS NULL
            THEN NULL
            ELSE to_char(
              rbh.break_end_time,
              'HH24:MI'
            )
          END
            AS break_end_time,

          rbh.is_closed,

          rbh.source,

          rbh.verified_at

        FROM restaurant_business_hours rbh

        JOIN jsonb_array_elements_text(
          ${keysJson}::jsonb
        )
          AS keys(
            restaurant_key
          )

          ON keys.restaurant_key =
             rbh.restaurant_key

        WHERE
          rbh.day_of_week =
          ${dayOfWeek}
      `;

  } catch (error) {

    /*
     * 초기 개발 중 SQL을 아직 적용하지 않았거나
     * 영업시간 테이블에 문제가 있어도
     * 음식점 추천 전체가 실패하지 않게 합니다.
     */
    console.error(
      "Business hours lookup error:",
      error
    );

    rows = [];
  }


  const rowByRestaurant =
    new Map<
      string,
      RawBusinessHoursRow
    >(
      rows.map(
        (row) => [
          row.restaurant_key,
          row,
        ]
      )
    );


  return restaurants.map(
    (restaurant) => {

      const businessHours =
        makeBusinessHoursInfo(
          rowByRestaurant.get(
            restaurant.id
          ),
          currentMinutes
        );


      /*
       * CLOSED / BREAK / 휴무는 추천에서 제외합니다.
       *
       * UNKNOWN은 실제로 닫았다는 뜻이 아니므로
       * 데이터 누락 때문에 정상 가게가 전부 사라지는 것을
       * 막기 위해 v1에서는 추천 가능 상태로 둡니다.
       */
      const recommendationEligible =
        businessHours.status ===
          "OPEN" ||
        businessHours.status ===
          "UNKNOWN";


      return {
        ...restaurant,

        businessHours,

        recommendationEligible,
      };
    }
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


    const rawStoredPreferences:
      string[] =
        storedPreferences.map(
          (item) =>
            String(
              item.menu_type
            )
        );


    const parsedStoredPreferences:
      string[] =

      parsePreferences(
        rawStoredPreferences
      ) ?? [];


    const preferences =

      parsedStoredPreferences.length > 0

        ? Array.from(
            new Set([
              ...rawStoredPreferences,
              ...parsedStoredPreferences,
            ])
          )

        : rawStoredPreferences;


    const normalizedPreferences =

      Array.from(

        new Set(

          preferences
            .map(
              normalizePreference
            )
            .filter(Boolean)
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
            .recommendations,

          aiResult
            .selectedFoods
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
              SearchMatchEvidence
            >;
        }
      >();


    let successfulSearches =
      0;


    for (
      const searchTerm
      of searchTerms
    ) {

      /*
       * 의미 별칭(alias)은 기준 위치의 동(area3)까지 포함합니다.
       *
       * 예:
       * 대전광역시 서구 둔산동 제육
       *
       * 이렇게 해야 상호명에 메뉴명이 없더라도
       * 가까운 백반집/한식집이 NAVER 후보군에 들어올 확률이 높아집니다.
       */
      const queryArea =
        searchTerm.kind ===
          "alias" &&
        displayArea
          ? displayArea
          : localSearchArea;


      const query =
        `${queryArea} ${searchTerm.name}`;


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

        if (
          !isRelevantNaverResult(
            item,
            searchTerm
          )
        ) {

          continue;
        }


        const menuCategoryRelevance =
          getNaverMenuCategoryRelevance(
            item,
            searchTerm
          );


        if (
          menuCategoryRelevance <
          MIN_NAVER_MATCH_RELEVANCE
        ) {

          continue;
        }


        const adjustedSearchScore =
          Math.round(
            searchTerm.score *
            menuCategoryRelevance
          );


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

          const currentEvidence =
            existing
              .matchedTerms
              .get(
                searchTerm.sourceMenu
              );


          existing
            .matchedTerms
            .set(
              searchTerm.sourceMenu,

              mergeSearchMatchEvidence(
                currentEvidence,
                searchTerm,
                adjustedSearchScore
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
                    mergeSearchMatchEvidence(
                      undefined,
                      searchTerm,
                      adjustedSearchScore
                    ),
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
      RestaurantCore[] = [];


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


      /*
       * 음식점별 대표 추천 메뉴
       *
       * 검색어 family가 아니라 sourceMenu 기준으로
       * 점수가 가장 높은 메뉴를 하나 선택합니다.
       *
       * 이 메뉴가 카드의 "추천 메뉴"가 되고,
       * 가격 resolver도 정확히 이 메뉴 가격만 조회합니다.
       */
      const rankedMatchedEntries =
        [...matchedEntries]
          .sort(
            (
              a,
              b
            ) => {
              const scoreDiff =
                b[1].score -
                a[1].score;

              if (scoreDiff !== 0) {
                return scoreDiff;
              }

              return (
                getRestaurantSearchConfidenceRank(
                  b[1].confidence
                ) -
                getRestaurantSearchConfidenceRank(
                  a[1].confidence
                )
              );
            }
          );


      const recommendedMenuName =
        rankedMatchedEntries[0]
          ?.[0] ??
        null;


      const recommendedMenuScore =
        rankedMatchedEntries[0]
          ?.[1].score ??
        null;


      const recommendedMenuEvidence =
        rankedMatchedEntries[0]
          ?.[1] ??
        null;


      const menuMatchConfidence =
        recommendedMenuEvidence
          ?.confidence ??
        null;


      const menuMatchConfidenceLabel =
        getRestaurantSearchConfidenceLabel(
          menuMatchConfidence
        );


      const menuMatchSearchTerm =
        recommendedMenuEvidence
          ?.query ??
        null;


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
                evidence,
              ]
            ) =>
              evidence.score
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

         메뉴 취향 70%
         거리      30%

         가격은 추천 점수에 반영하지 않습니다.
         가격은 별도 표시와 예산 필터에만 사용합니다.
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

        venueType:
          getRestaurantVenueType(
            item
          ),

        venueTypeLabel:
          getRestaurantVenueType(
            item
          ) ===
          "bar"
            ? "술집"
            : "음식점",

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
          rankedMatchedEntries.map(
            (
              [
                name,
              ]
            ) =>
              name
          ),

        recommendedMenuName,

        recommendedMenuScore,

        menuMatchConfidence,

        menuMatchConfidenceLabel,

        menuMatchSearchTerm,

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

    const radiusFilteredRestaurants =
      restaurants.filter(
        (restaurant) =>
          restaurant.distance <=
          radiusMeters
      );


    /*
     * 가격 resolver
     *
     * 1) 해당 음식점의 검증된 실제 추천 메뉴 가격
     * 2) 없으면 같은 메뉴의 지역 평균가
     * 3) 둘 다 없으면 가격 정보 없음
     *
     * 중요:
     * 가격은 recommendScore에 반영하지 않습니다.
     * 프론트에서 가격 표시와 "예산맞춤" 필터에만 사용합니다.
     */
    const pricedRestaurants =
      await attachRestaurantPrices(
        radiusFilteredRestaurants,
        area1,
        area2
      );


    /*
     * 영업시간 DB를 붙입니다.
     *
     * 추천 대상에서 제외되는 CLOSED/BREAK 가게도
     * 응답에는 남겨 프론트에서 빨간색/주황색 상태로
     * 별도 표시할 수 있게 합니다.
     */
    const finalRestaurants =
      await attachBusinessHours(
        pricedRestaurants
      );


    /* =====================================================
       7. 기본 정렬

       1) 추천 가능한 가게 우선
       2) 종합 추천 점수 순

       프론트에서도 추천 리스트에서는
       recommendationEligible=false를 다시 제외합니다.
    ===================================================== */

    finalRestaurants.sort(
      (a, b) => {

        if (
          a.recommendationEligible !==
          b.recommendationEligible
        ) {

          return a.recommendationEligible
            ? -1
            : 1;
        }


        const scoreDiff =
          b.recommendScore -
          a.recommendScore;


        if (scoreDiff !== 0) {
          return scoreDiff;
        }


        return (
          getRestaurantSearchConfidenceRank(
            b.menuMatchConfidence
          ) -
          getRestaurantSearchConfidenceRank(
            a.menuMatchConfidence
          )
        );
      }
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

                  anchorFamilyAffinity:
                    item.bestAnchor
                      ? Number(
                          getFamilyAffinity(
                            getFoodFamily(
                              item.bestAnchor,
                              null
                            ),
                            item.family
                          ).toFixed(2)
                        )
                      : 0,

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