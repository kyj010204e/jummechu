import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getUserId } from "@/lib/session";
import { parseCoordinate } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildPairRecommendationContext,
  PairRecommendationError,
  type PairRecommendation,
} from "@/lib/pair-recommendation";

import {
  buildExpandedRestaurantSearchTerms,
  getRestaurantSearchConfidence,
  getRestaurantSearchConfidenceLabel,
  getRestaurantSearchConfidenceRank,
  type RestaurantSearchConfidence,
  type RestaurantSearchTerm,
} from "@/lib/restaurant-search-terms";

const DEFAULT_RADIUS_KM = 5;
const ALLOWED_RADIUS_KM = new Set([1, 2, 3, 4, 5]);

const NAVER_SEARCH_MENU_COUNT = 8;
const NAVER_FAMILY_SEARCH_COUNT = 6;
type ReverseGeocodeResult = {
  name: string;
  region: {
    area1?: { name?: string };
    area2?: { name?: string };
    area3?: { name?: string };
    area4?: { name?: string };
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

type SearchTerm = RestaurantSearchTerm;

type SearchMatchEvidence = {
  score: number;
  confidence: RestaurantSearchConfidence;
  query: string;
  kind: SearchTerm["kind"];
};

function mergeSearchMatchEvidence(
  current: SearchMatchEvidence | undefined,
  searchTerm: SearchTerm,
  score: number
): SearchMatchEvidence {
  const confidence =
    getRestaurantSearchConfidence(searchTerm.kind);

  if (!current) {
    return {
      score,
      confidence,
      query: searchTerm.name,
      kind: searchTerm.kind,
    };
  }

  const nextRank =
    getRestaurantSearchConfidenceRank(confidence);
  const currentRank =
    getRestaurantSearchConfidenceRank(current.confidence);

  const replaceDescriptor =
    nextRank > currentRank ||
    (nextRank === currentRank && score > current.score);

  return {
    score: Math.max(current.score, score),
    confidence: replaceDescriptor
      ? confidence
      : current.confidence,
    query: replaceDescriptor
      ? searchTerm.name
      : current.query,
    kind: replaceDescriptor
      ? searchTerm.kind
      : current.kind,
  };
}

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
  matchedPreferences: string[];
  recommendedMenuName: string | null;
  menuMatchConfidence: RestaurantSearchConfidence | null;
  menuMatchConfidenceLabel: string | null;
  menuMatchSearchTerm: string | null;
  preferenceScore: number;
  distanceScore: number;
  recommendScore: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").trim();
}

function buildNaverSearchTerms(
  recommendations: PairRecommendation[]
): SearchTerm[] {
  return buildExpandedRestaurantSearchTerms(
    recommendations.map((item) => ({
      name: item.name,
      family: item.family,
      cuisineType: item.cuisineType,
      foodType: item.foodType,
      score: clamp(item.score, 0, 100),
    })),
    {
      exactLimit: NAVER_SEARCH_MENU_COUNT,
      aliasLimit: 8,
      familyLimit: NAVER_FAMILY_SEARCH_COUNT,
    }
  );
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const earthRadius = 6371000;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );

  return Math.round(earthRadius * c);
}

function parseNaverCoordinate(
  value: string,
  type: "longitude" | "latitude"
) {
  let coordinate = Number(value);

  if (!Number.isFinite(coordinate)) return NaN;

  if (type === "longitude" && Math.abs(coordinate) > 180) {
    coordinate /= 10_000_000;
  }

  if (type === "latitude" && Math.abs(coordinate) > 90) {
    coordinate /= 10_000_000;
  }

  return parseCoordinate(coordinate, type) ?? NaN;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const limited =
      rateLimit(
        "friend-restaurants-user",
        20,
        60_000,
        userId.toString()
      ) ??
      rateLimit(
        "naver-search-global",
        120,
        60_000
      );

    if (limited) return limited;

    const { searchParams } = new URL(request.url);

    const sessionIdText = searchParams.get("sessionId") ?? "";

    if (!/^\d+$/.test(sessionIdText)) {
      return NextResponse.json(
        { message: "sessionId가 필요합니다." },
        { status: 400 }
      );
    }

    const latitude = parseCoordinate(
      searchParams.get("latitude"),
      "latitude"
    );

    const longitude = parseCoordinate(
      searchParams.get("longitude"),
      "longitude"
    );

    if (latitude === null || longitude === null) {
      return NextResponse.json(
        { message: "latitude와 longitude가 필요합니다." },
        { status: 400 }
      );
    }

    const requestedRadiusKm = Number(
      searchParams.get("radiusKm")
    );

    const radiusKm = ALLOWED_RADIUS_KM.has(requestedRadiusKm)
      ? requestedRadiusKm
      : DEFAULT_RADIUS_KM;

    const radiusMeters = radiusKm * 1000;

    const mapsClientId = process.env.NAVER_MAPS_CLIENT_ID;
    const mapsClientSecret = process.env.NAVER_MAPS_CLIENT_SECRET;
    const searchClientId = process.env.NAVER_SEARCH_CLIENT_ID;
    const searchClientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

    if (!mapsClientId || !mapsClientSecret) {
      return NextResponse.json(
        { message: "NAVER Maps 환경변수가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    if (!searchClientId || !searchClientSecret) {
      return NextResponse.json(
        { message: "NAVER Search 환경변수가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    /* =====================================================
       1. 두 사람의 공통 취향 임베딩 추천
    ===================================================== */

    const pair = await buildPairRecommendationContext(
      BigInt(sessionIdText),
      userId
    );

    const searchTerms = buildNaverSearchTerms(
      pair.recommendations
    );

    if (searchTerms.length === 0) {
      return NextResponse.json({
        region: {
          area1: "",
          area2: "",
          area3: "",
          displayName: "",
        },
        recommendationMode: pair.recommendationMode,
        recommendedMenus: pair.recommendations,
        searchMenus: [],
        naverSearchTerms: [],
        radiusKm,
        restaurants: [],
        message: "공통 추천 메뉴를 만들지 못했습니다.",
      });
    }

    /* =====================================================
       2. 기준 좌표 → 행정구역
    ===================================================== */

    const reverseUrl =
      "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc" +
      `?coords=${longitude},${latitude}` +
      "&output=json" +
      "&orders=admcode,legalcode";

    const reverseResponse = await fetch(reverseUrl, {
      method: "GET",
      headers: {
        "x-ncp-apigw-api-key-id": mapsClientId,
        "x-ncp-apigw-api-key": mapsClientSecret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!reverseResponse.ok) {
      const detail = await reverseResponse.text();
      console.error("Friend reverse geocoding error:", detail);

      return NextResponse.json(
        { message: "선택한 위치의 주소를 찾지 못했습니다." },
        { status: reverseResponse.status }
      );
    }

    const reverseData =
      (await reverseResponse.json()) as ReverseGeocodeResponse;

    const regionResult =
      reverseData.results?.find((item) => item.name === "admcode") ??
      reverseData.results?.find((item) => item.name === "legalcode") ??
      reverseData.results?.[0];

    if (!regionResult) {
      return NextResponse.json(
        { message: "선택한 위치의 행정구역을 찾지 못했습니다." },
        { status: 404 }
      );
    }

    const area1 = regionResult.region.area1?.name ?? "";
    const area2 = regionResult.region.area2?.name ?? "";
    const area3 = regionResult.region.area3?.name ?? "";

    const displayArea = [area1, area2, area3]
      .filter(Boolean)
      .join(" ");

    /*
     * 개인 추천과 동일하게 3~5km 검색에서는
     * 동 하나로 한정하지 않고 시/도 + 시/군/구를 검색어에 사용합니다.
     */
    const localSearchArea =
      [area1, area2].filter(Boolean).join(" ") || displayArea;

    /* =====================================================
       3. 공통 추천 메뉴 → NAVER Local Search
    ===================================================== */

    const collected = new Map<
      string,
      {
        item: NaverLocalItem;
        matchedTerms: Map<string, SearchMatchEvidence>;
      }
    >();

    let successfulSearches = 0;

    for (const searchTerm of searchTerms) {
      /*
       * 의미 별칭(alias)은 기준 위치의 동(area3)까지 포함해
       * 가까운 소규모 식당의 검색 누락을 줄입니다.
       */
      const queryArea =
        searchTerm.kind === "alias" && displayArea
          ? displayArea
          : localSearchArea;

      const query = `${queryArea} ${searchTerm.name}`;

      const searchUrl =
        "https://naverapihub.apigw.ntruss.com/search/v1/local" +
        `?query=${encodeURIComponent(query)}` +
        "&display=5" +
        "&start=1" +
        "&sort=comment" +
        "&format=json";

      const localResponse = await fetch(searchUrl, {
        method: "GET",
        headers: {
          "X-NCP-APIGW-API-KEY-ID": searchClientId,
          "X-NCP-APIGW-API-KEY": searchClientSecret,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });

      if (!localResponse.ok) {
        console.error(
          "Friend NAVER Local Search failed:",
          searchTerm.name,
          await localResponse.text()
        );
        continue;
      }

      successfulSearches++;

      const localData =
        (await localResponse.json()) as NaverLocalResponse;

      for (const item of localData.items ?? []) {
        const cleanTitle = stripHtml(item.title);
        const key = `${cleanTitle}|${item.roadAddress || item.address}`;
        const existing = collected.get(key);

        if (existing) {
          const currentEvidence =
            existing.matchedTerms.get(searchTerm.sourceMenu);

          existing.matchedTerms.set(
            searchTerm.sourceMenu,
            mergeSearchMatchEvidence(
              currentEvidence,
              searchTerm,
              searchTerm.score
            )
          );
        } else {
          collected.set(key, {
            item,
            matchedTerms: new Map([
              [
                searchTerm.sourceMenu,
                mergeSearchMatchEvidence(
                  undefined,
                  searchTerm,
                  searchTerm.score
                ),
              ],
            ]),
          });
        }
      }
    }

    if (successfulSearches === 0) {
      return NextResponse.json(
        {
          message:
            "음식점 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
        },
        { status: 502 }
      );
    }

    /* =====================================================
       4. 실제 거리 + 공통 취향 점수
    ===================================================== */

    const restaurants: Restaurant[] = [];

    for (const [key, value] of collected.entries()) {
      const item = value.item;

      const restaurantLongitude = parseNaverCoordinate(
        item.mapx,
        "longitude"
      );

      const restaurantLatitude = parseNaverCoordinate(
        item.mapy,
        "latitude"
      );

      if (
        !Number.isFinite(restaurantLatitude) ||
        !Number.isFinite(restaurantLongitude)
      ) {
        continue;
      }

      const distance = calculateDistance(
        latitude,
        longitude,
        restaurantLatitude,
        restaurantLongitude
      );

      const distanceScore = clamp(
        Math.round(
          100 -
          (distance / radiusMeters) * 100
        ),
        0,
        100
      );

      const matchedEntries = Array.from(
        value.matchedTerms.entries()
      );

      const rankedMatchedEntries =
        [...matchedEntries].sort((a, b) => {
          const scoreDiff = b[1].score - a[1].score;

          if (scoreDiff !== 0) {
            return scoreDiff;
          }

          return (
            getRestaurantSearchConfidenceRank(b[1].confidence) -
            getRestaurantSearchConfidenceRank(a[1].confidence)
          );
        });

      const recommendedMenuName =
        rankedMatchedEntries[0]?.[0] ?? null;

      const recommendedEvidence =
        rankedMatchedEntries[0]?.[1] ?? null;

      const menuMatchConfidence =
        recommendedEvidence?.confidence ?? null;

      const menuMatchConfidenceLabel =
        getRestaurantSearchConfidenceLabel(menuMatchConfidence);

      const menuMatchSearchTerm =
        recommendedEvidence?.query ?? null;

      const scores = matchedEntries.map(([, evidence]) => evidence.score);

      const maxScore =
        scores.length > 0
          ? Math.max(...scores)
          : 0;

      const averageScore =
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) /
            scores.length
          : 0;

      const basePreference =
        maxScore * 0.80 +
        averageScore * 0.20;

      const multiMenuBonus = Math.min(
        10,
        Math.max(0, scores.length - 1) * 3
      );

      const preferenceScore = clamp(
        Math.round(basePreference + multiMenuBonus),
        0,
        100
      );

      const recommendScore = Math.round(
        preferenceScore * 0.70 +
        distanceScore * 0.30
      );

      restaurants.push({
        id: key,
        name: stripHtml(item.title),
        category: item.category,
        address: item.address,
        roadAddress: item.roadAddress,
        link: item.link,
        latitude: restaurantLatitude,
        longitude: restaurantLongitude,
        distance,
        matchedPreferences: rankedMatchedEntries.map(([name]) => name),
        recommendedMenuName,
        menuMatchConfidence,
        menuMatchConfidenceLabel,
        menuMatchSearchTerm,
        preferenceScore,
        distanceScore,
        recommendScore,
      });
    }

    const finalRestaurants = restaurants
      .filter((restaurant) => restaurant.distance <= radiusMeters)
      .sort((a, b) => {
        const scoreDiff = b.recommendScore - a.recommendScore;

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return (
          getRestaurantSearchConfidenceRank(b.menuMatchConfidence) -
          getRestaurantSearchConfidenceRank(a.menuMatchConfidence)
        );
      });

    return NextResponse.json({
      region: {
        area1,
        area2,
        area3,
        displayName: displayArea,
      },
      recommendationMode:
        pair.recommendationMode === "embedding"
          ? "pair_embedding"
          : "pair_fallback",
      recommendedMenus: pair.recommendations,
      searchMenus: Array.from(
        new Set(
          searchTerms
            .filter((item) => item.kind !== "family")
            .map((item) => item.sourceMenu)
        )
      ),
      naverSearchTerms: searchTerms.map((item) => ({
        query: item.name,
        sourceMenu: item.sourceMenu,
        kind: item.kind,
      })),
      radiusKm,
      message:
        successfulSearches < searchTerms.length
          ? "일부 메뉴 검색에 실패했습니다. 잠시 후 다시 검색해주세요."
          : undefined,
      /*
       * friend map의 기존 표시 타입과 바로 호환되도록
       * 개인 추천 필드명 + 기존 친구 지도 alias를 함께 내려줍니다.
       */
      restaurants: finalRestaurants.map((restaurant) => ({
        ...restaurant,
        jibunAddress: restaurant.address,
        source: "local" as const,
        matchedMenus: restaurant.matchedPreferences,
        menuScore: restaurant.preferenceScore,
        finalScore: restaurant.recommendScore,
      })),
    });
  } catch (error) {
    if (error instanceof PairRecommendationError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status }
      );
    }

    console.error("Friend restaurant API error:", error);

    return NextResponse.json(
      { message: "공통 음식점 검색 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
