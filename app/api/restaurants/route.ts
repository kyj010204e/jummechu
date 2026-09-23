import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { parseCoordinate, parsePreferences } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

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
  preferenceScore: number;
  distanceScore: number;
  recommendScore: number;
};

const PREFERENCE_KEYWORDS: Record<string, string> = {
  // 혹시 preferences에서 영문 ID를 저장했다면 대응
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

  // 한글 그대로 저장했을 경우 대응
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

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
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

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadius * c);
}

function normalizePreference(value: string) {
  return PREFERENCE_KEYWORDS[value] ?? value;
}

function parseNaverCoordinate(
        value: string,
        type: "longitude" | "latitude"
        ) {
        let coordinate = Number(value);

        if (!Number.isFinite(coordinate)) {
            return NaN;
        }

        /*
        * NAVER 지역검색 좌표가
        * 1271234567 / 361234567 같은 정수 형태라면
        * 실제 WGS84 좌표로 변환
        */
        if (
            type === "longitude" &&
            Math.abs(coordinate) > 180
        ) {
            coordinate = coordinate / 10_000_000;
        }

        if (
            type === "latitude" &&
            Math.abs(coordinate) > 90
        ) {
            coordinate = coordinate / 10_000_000;
        }

        return parseCoordinate(coordinate, type) ?? NaN;
        }

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const limited = rateLimit("restaurants-user", 20, 60_000, userId.toString()) ?? rateLimit("naver-search-global", 120, 60_000);
    if (limited) return limited;
    const latitude = parseCoordinate(searchParams.get("latitude"), "latitude");
    const longitude = parseCoordinate(searchParams.get("longitude"), "longitude");

    if (latitude === null || longitude === null) {
      return NextResponse.json(
        {
          message: "latitude와 longitude가 필요합니다.",
        },
        {
          status: 400,
        }
      );
    }

    const mapsClientId = process.env.NAVER_MAPS_CLIENT_ID;
    const mapsClientSecret = process.env.NAVER_MAPS_CLIENT_SECRET;

    const searchClientId = process.env.NAVER_SEARCH_CLIENT_ID;
    const searchClientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;

    if (!mapsClientId || !mapsClientSecret) {
      return NextResponse.json(
        {
          message: "NAVER Maps 환경변수가 설정되지 않았습니다.",
        },
        {
          status: 500,
        }
      );
    }

    if (!searchClientId || !searchClientSecret) {
      return NextResponse.json(
        {
          message: "NAVER Search 환경변수가 설정되지 않았습니다.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * 1. 사용자의 선호 메뉴 가져오기
     */
    const storedPreferences = await prisma.user_preferences.findMany({ where: { user_id: userId }, orderBy: { id: "asc" } });
    const preferences = parsePreferences(storedPreferences.map((item) => item.menu_type)) ?? [];

    const normalizedPreferences = Array.from(
      new Set(preferences.map(normalizePreference))
    );

    /*
     * 선호 메뉴가 혹시 없을 경우 기본 검색
     */
    const searchPreferences =
      normalizedPreferences.length > 0
        ? normalizedPreferences
        : ["맛집"];

    /*
     * 2. GPS → 행정동 변환
     *
     * 주의:
     * coords는 "경도,위도" 순서
     */
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

      console.error("Reverse Geocoding error:", detail);

      return NextResponse.json(
        {
          message: "현재 위치의 주소를 찾지 못했습니다.",
        },
        {
          status: reverseResponse.status,
        }
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
        {
          message: "현재 위치의 행정구역을 찾지 못했습니다.",
        },
        {
          status: 404,
        }
      );
    }

    const area1 = regionResult.region.area1?.name ?? "";
    const area2 = regionResult.region.area2?.name ?? "";
    const area3 = regionResult.region.area3?.name ?? "";

    const searchArea = [area1, area2, area3]
      .filter(Boolean)
      .join(" ");

    /*
     * 3. 선호 메뉴마다 NAVER 지역 검색
     *
     * 예:
     * "대전광역시 서구 월평동 한식"
     * "대전광역시 서구 월평동 일식"
     */
    const collected = new Map<
      string,
      {
        item: NaverLocalItem;
        matchedPreferences: Set<string>;
      }
    >();

    let successfulSearches = 0;
    for (const preference of searchPreferences) {
      const query = `${searchArea} ${preference}`;

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
          "NAVER Local Search failed:",
          preference,
          await localResponse.text()
        );

        continue;
      }

      successfulSearches++;
      const localData =
        (await localResponse.json()) as NaverLocalResponse;

      for (const item of localData.items ?? []) {
        const cleanTitle = stripHtml(item.title);

        const key = `${cleanTitle}|${
          item.roadAddress || item.address
        }`;

        const existing = collected.get(key);

        if (existing) {
          existing.matchedPreferences.add(preference);
        } else {
          collected.set(key, {
            item,
            matchedPreferences: new Set([preference]),
          });
        }
      }
    }

    if (successfulSearches === 0) return NextResponse.json({ message: "음식점 검색 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });

    /*
     * 4. 거리 및 추천 점수 계산
     */
    const restaurants: Restaurant[] = [];

    for (const [key, value] of collected.entries()) {
      const item = value.item;

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

      /*
       * 2km 기준으로 거리 점수 계산
       *
       * 0m   -> 100
       * 1km  -> 50
       * 2km+ -> 0
       */
      const distanceScore = Math.max(
        0,
        Math.min(100, Math.round(100 - distance / 20))
      );

      /*
       * 선택한 선호 메뉴가 여러 검색 결과에서 겹칠수록 높은 점수
       */
      const matchCount = value.matchedPreferences.size;

      const preferenceScore = Math.min(
        100,
        60 + Math.max(0, matchCount - 1) * 20
      );

      /*
       * 현재 추천 프로토타입:
       * 메뉴 선호 60%
       * 거리 40%
       *
       * 향후 embedding/cosine similarity로 교체 가능
       */
      const recommendScore = Math.round(
        preferenceScore * 0.6 +
          distanceScore * 0.4
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
        matchedPreferences: Array.from(
          value.matchedPreferences
        ),
        preferenceScore,
        distanceScore,
        recommendScore,
      });
    }

    /*
     * 우선 2km 안의 음식점만 사용
     */
    const nearbyRestaurants = restaurants.filter(
      (restaurant) => restaurant.distance <= 2000
    );

    /*
     * 2km 안에 하나도 없다면 검색 결과 중 가까운 곳을 보여줌
     */
    const finalRestaurants =
      nearbyRestaurants.length > 0
        ? nearbyRestaurants
        : restaurants;

    finalRestaurants.sort(
      (a, b) => b.recommendScore - a.recommendScore
    );

    return NextResponse.json({
      region: {
        area1,
        area2,
        area3,
        displayName: searchArea,
      },

      message: successfulSearches < searchPreferences.length ? "일부 메뉴 검색에 실패했습니다. 잠시 후 다시 검색해주세요." : undefined,
      preferences: searchPreferences,

      restaurants: finalRestaurants.slice(0, 15),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "음식점 검색 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}