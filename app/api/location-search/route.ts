import { parseCoordinate } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import {
  NextRequest,
  NextResponse,
} from "next/server";

/* =========================================================
   NAVER GEOCODING 타입
========================================================= */

type AddressElement = {
  types?: string[];
  longName?: string;
  shortName?: string;
  code?: string;
};

type GeocodeAddress = {
  roadAddress: string;
  jibunAddress: string;
  englishAddress: string;

  addressElements?: AddressElement[];

  x: string;
  y: string;

  distance?: number;
};

type GeocodeResponse = {
  status?: string;

  meta?: {
    totalCount?: number;
    page?: number;
    count?: number;
  };

  addresses?: GeocodeAddress[];

  errorMessage?: string;
};

/* =========================================================
   NAVER LOCAL SEARCH 타입
========================================================= */

type LocalItem = {
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

type LocalResponse = {
  items?: LocalItem[];
};

/* =========================================================
   최종 검색 결과
========================================================= */

type LocationSearchItem = {
  id: string;

  name: string;

  roadAddress: string;
  jibunAddress: string;

  category: string;

  latitude: number;
  longitude: number;

  distance: number | null;

  source:
    | "geocode"
    | "local";
};

/* =========================================================
   UTIL
========================================================= */

function stripHtml(
  value: string
) {
  return value.replace(
    /<[^>]*>/g,
    ""
  );
}

function toRadians(
  value: number
) {
  return (
    (value * Math.PI) /
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
    ) ** 2 +
    Math.cos(
      toRadians(lat1)
    ) *
      Math.cos(
        toRadians(lat2)
      ) *
      Math.sin(
        dLon / 2
      ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return Math.round(
    earthRadius * c
  );
}

/*
 * NAVER Local Search 좌표 대응
 *
 * 혹시 1271234567 형태로
 * 내려오는 경우에도 처리
 */
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

  if (
    type ===
      "longitude" &&
    Math.abs(coordinate) >
      180
  ) {
    coordinate =
      coordinate /
      10_000_000;
  }

  if (
    type ===
      "latitude" &&
    Math.abs(coordinate) >
      90
  ) {
    coordinate =
      coordinate /
      10_000_000;
  }

  return parseCoordinate(coordinate, type) ?? NaN;
}

/*
 * Geocoding 결과에서
 * 건물명 찾기
 */
function getBuildingName(
  elements:
    | AddressElement[]
    | undefined
) {
  if (!elements) {
    return "";
  }

  const building =
    elements.find(
      (element) =>
        element.types?.includes(
          "BUILDING_NAME"
        )
    );

  return (
    building?.longName ??
    ""
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
    } = new URL(
      request.url
    );

    const query =
      searchParams
        .get("query")
        ?.trim();

    if (!query || query.length > 200) return NextResponse.json({ message: "검색어는 1~200자로 입력해주세요." }, { status: 400 });
    const latitude = parseCoordinate(searchParams.get("latitude"), "latitude");
    const longitude = parseCoordinate(searchParams.get("longitude"), "longitude");
    const hasCenter = latitude !== null && longitude !== null;
    if ((searchParams.has("latitude") || searchParams.has("longitude")) && !hasCenter) {
      return NextResponse.json({ message: "올바른 기준 좌표가 아닙니다." }, { status: 400 });
    }
    const limited = rateLimit("naver-search-global", 120, 60_000);
    if (limited) return limited;

    /* =====================================================
       API KEY
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
            "NAVER Maps 환경변수가 없습니다.",
        },
        {
          status: 500,
        }
      );
    }

    /* =====================================================
       1. GEOCODING
    ===================================================== */

    const geocodeParams =
      new URLSearchParams({
        query,
        count: "30",
        page: "1",
      });

    /*
     * 검색 기준 위치가 존재하면
     * 가까운 결과부터 요청
     */
    if (hasCenter) {
      geocodeParams.set(
        "coordinate",
        `${longitude},${latitude}`
      );
    }

    const geocodeUrl =
      "https://maps.apigw.ntruss.com/map-geocode/v2/geocode" +
      `?${geocodeParams.toString()}`;

    const geocodePromise =
      fetch(
        geocodeUrl,
        {
          method: "GET",

          headers: {
            "x-ncp-apigw-api-key-id":
              mapsClientId,

            "x-ncp-apigw-api-key":
              mapsClientSecret,

            Accept:
              "application/json",
          },

          cache:
            "no-store",
          signal: AbortSignal.timeout(10_000),
        }
      );

    /* =====================================================
       2. LOCAL SEARCH
    ===================================================== */

    let localPromise:
      Promise<Response> | null =
        null;

    if (
      searchClientId &&
      searchClientSecret
    ) {
      const localUrl =
        "https://naverapihub.apigw.ntruss.com/search/v1/local" +
        `?query=${encodeURIComponent(
          query
        )}` +
        "&display=5" +
        "&start=1" +
        "&format=json";

      localPromise =
        fetch(
          localUrl,
          {
            method: "GET",

            headers: {
              "X-NCP-APIGW-API-KEY-ID":
                searchClientId,

              "X-NCP-APIGW-API-KEY":
                searchClientSecret,
            },

            cache:
              "no-store",
            signal: AbortSignal.timeout(10_000),
          }
        );
    }

    /* =====================================================
       결과 수집
    ===================================================== */

    const results:
      LocationSearchItem[] =
      [];

    /* =========================
       GEOCODING 처리
    ========================== */

    const [geocodeOutcome, localOutcome] = await Promise.allSettled([geocodePromise, localPromise]);
    const geocodeResponse = geocodeOutcome.status === "fulfilled" ? geocodeOutcome.value : null;
    const localResponse = localOutcome.status === "fulfilled" ? localOutcome.value : null;
    if (!geocodeResponse?.ok && !localResponse?.ok) {
      return NextResponse.json({ message: "장소 검색 서비스에 연결하지 못했습니다." }, { status: 502 });
    }

    if (
      geocodeResponse?.ok
    ) {
      const geocodeData =
        (await geocodeResponse.json()) as GeocodeResponse;

      for (
        const address of
        geocodeData.addresses ??
        []
      ) {
        const resultLatitude =
          Number(address.y);

        const resultLongitude =
          Number(address.x);

        if (
          !Number.isFinite(
            resultLatitude
          ) ||
          !Number.isFinite(
            resultLongitude
          )
        ) {
          continue;
        }

        const buildingName =
          getBuildingName(
            address.addressElements
          );

        const distance =
          hasCenter
            ? calculateDistance(
                latitude,
                longitude,
                resultLatitude,
                resultLongitude
              )
            : null;

        results.push({
          id:
            `geo-${resultLatitude}-${resultLongitude}`,

          /*
           * 건물명이 있으면 건물명
           * 없으면 사용자가 입력한 검색어
           */
          name:
            buildingName ||
            query,

          roadAddress:
            address.roadAddress,

          jibunAddress:
            address.jibunAddress,

          category:
            "주소/건물",

          latitude:
            resultLatitude,

          longitude:
            resultLongitude,

          distance,

          source:
            "geocode",
        });
      }
    }

    /* =========================
       LOCAL SEARCH 처리
    ========================== */

    if (localResponse) {

      if (
        localResponse.ok
      ) {
        const localData =
          (await localResponse.json()) as LocalResponse;

        for (
          const item of
          localData.items ?? []
        ) {
          const resultLongitude =
            parseNaverCoordinate(
              item.mapx,
              "longitude"
            );

          const resultLatitude =
            parseNaverCoordinate(
              item.mapy,
              "latitude"
            );

          if (
            !Number.isFinite(
              resultLatitude
            ) ||
            !Number.isFinite(
              resultLongitude
            )
          ) {
            continue;
          }

          const distance =
            hasCenter
              ? calculateDistance(
                  latitude,
                  longitude,
                  resultLatitude,
                  resultLongitude
                )
              : null;

          results.push({
            id:
              `local-${resultLatitude}-${resultLongitude}`,

            name:
              stripHtml(
                item.title
              ),

            roadAddress:
              item.roadAddress,

            jibunAddress:
              item.address,

            category:
              item.category,

            latitude:
              resultLatitude,

            longitude:
              resultLongitude,

            distance,

            source:
              "local",
          });
        }
      }
    }

    /* =====================================================
       중복 제거
    ===================================================== */

    const unique =
      new Map<
        string,
        LocationSearchItem
      >();

    for (
      const result of
      results
    ) {
      /*
       * 약 10m 수준으로 좌표를 묶어서
       * 같은 장소 중복 제거
       */
      const key =
        `${result.latitude.toFixed(
          5
        )}` +
        "|" +
        `${result.longitude.toFixed(
          5
        )}`;

      const existing =
        unique.get(key);

      /*
       * 같은 위치라면
       * 이름이 더 구체적인 Local 결과 우선
       */
      if (!existing) {
        unique.set(
          key,
          result
        );

        continue;
      }

      if (
        existing.source ===
          "geocode" &&
        result.source ===
          "local"
      ) {
        unique.set(
          key,
          result
        );
      }
    }

    const finalResults =
      Array.from(
        unique.values()
      );

    /* =====================================================
       가까운 순 정렬
    ===================================================== */

    if (hasCenter) {
      finalResults.sort(
        (a, b) => {
          const distanceA =
            a.distance ??
            Number.MAX_VALUE;

          const distanceB =
            b.distance ??
            Number.MAX_VALUE;

          return (
            distanceA -
            distanceB
          );
        }
      );
    }

    return NextResponse.json({
      query,

      center: hasCenter
        ? {
            latitude,
            longitude,
          }
        : null,

      results:
        finalResults.slice(
          0,
          30
        ),
    });
  } catch (error) {
    console.error(
      "Location Search:",
      error
    );

    return NextResponse.json(
      {
        message:
          "장소 검색 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}