import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

type GeocodeAddress = {
  roadAddress: string;
  jibunAddress: string;
  englishAddress: string;
  x: string;
  y: string;
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get("query")?.trim();

    if (!query || query.length > 200) {
      return NextResponse.json(
        {
          message: "검색할 위치를 입력해주세요.",
        },
        {
          status: 400,
        }
      );
    }

    const limited = rateLimit("naver-search-global", 120, 60_000);
    if (limited) return limited;
    const clientId =
      process.env.NAVER_MAPS_CLIENT_ID;

    const clientSecret =
      process.env.NAVER_MAPS_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
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

    const url =
      "https://maps.apigw.ntruss.com/map-geocode/v2/geocode" +
      `?query=${encodeURIComponent(query)}` +
      "&count=10";

    const response = await fetch(url, {
      method: "GET",

      headers: {
        "x-ncp-apigw-api-key-id":
          clientId,

        "x-ncp-apigw-api-key":
          clientSecret,

        Accept: "application/json",
      },

      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const data =
      (await response.json()) as GeocodeResponse;

    if (!response.ok) {
      console.error(
        "NAVER Geocoding error:",
        data
      );

      return NextResponse.json(
        {
          message:
            "주소 검색 중 오류가 발생했습니다.",
        },
        {
          status: response.status,
        }
      );
    }

    const results =
      (data.addresses ?? []).map(
        (address, index) => ({
          id: `${index}-${address.x}-${address.y}`,

          roadAddress:
            address.roadAddress,

          jibunAddress:
            address.jibunAddress,

          latitude:
            Number(address.y),

          longitude:
            Number(address.x),
        })
      );

    return NextResponse.json({
      query,
      results,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message:
          "주소 검색 중 문제가 발생했습니다.",
      },
      {
        status: 500,
      }
    );
  }
}