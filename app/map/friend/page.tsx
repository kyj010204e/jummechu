"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";


type CommonMenu = {
  id: string;
  name: string;
  cuisineType: string | null;
  foodType: string | null;
  score: number;
  userAScore: number;
  userBScore: number;
  exactCommon: boolean;
  bothFavorite: boolean;
};


type SessionResponse = {
  session: {
    id: string;
    status: string;
  };
  me: {
    id: string;
    name: string;
    email: string;
  };
  friend: {
    id: string;
    name: string;
    email: string;
  };
  commonPreferences: Array<{
    id: string;
    name: string;
  }>;
  recommendations: CommonMenu[];
  message?: string;
};


type LocationData = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};


type LocationSearchResult = {
  id: string;
  name: string;
  roadAddress: string;
  jibunAddress: string;
  category: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  source: "geocode" | "local";
};


type LocationSearchResponse = {
  results?: LocationSearchResult[];
  message?: string;
};


type RecommendedPlace = LocationSearchResult & {
  matchedMenus: string[];
  recommendedMenuName?: string | null;
  menuMatchConfidence?:
    | "exact"
    | "alias"
    | "broad"
    | null;
  menuMatchConfidenceLabel?: string | null;
  menuMatchSearchTerm?: string | null;
  menuScore: number;
  distanceScore: number;
  finalScore: number;
};


type NaverLatLng = {
  lat(): number;
  lng(): number;
};


interface NaverMapInstance {
  setCenter(position: NaverLatLng): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: NaverLatLngBounds): void;
  getCenter(): NaverLatLng;
}


type NaverLatLngBounds = {
  extend(position: NaverLatLng): void;
};


interface NaverMarkerInstance {
  setMap(map: NaverMapInstance | null): void;
}


function escapeHtml(
  value: string
) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getMenuMatchConfidenceMeta(
  place: RecommendedPlace
) {
  if (place.menuMatchConfidence === "exact") {
    return {
      label:
        place.menuMatchConfidenceLabel ??
        "메뉴명 직접 검색",
      className:
        "bg-emerald-50 text-emerald-700",
    };
  }

  if (place.menuMatchConfidence === "alias") {
    return {
      label:
        place.menuMatchConfidenceLabel ??
        "유사 메뉴명 기준",
      className:
        "bg-blue-50 text-blue-700",
    };
  }

  if (place.menuMatchConfidence === "broad") {
    return {
      label:
        place.menuMatchConfidenceLabel ??
        "넓은 계열 기준",
      className:
        "bg-amber-50 text-amber-700",
    };
  }

  return null;
}


function getStoredLocation(): LocationData | null {
  try {
    const raw =
      localStorage.getItem(
        "jummechu_location"
      );

    if (!raw) {
      return null;
    }

    const parsed =
      JSON.parse(raw);

    const latitude =
      Number(parsed?.latitude);

    const longitude =
      Number(parsed?.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    const rawName =
      typeof parsed?.name === "string"
        ? parsed.name.trim()
        : "";

    const rawAddress =
      typeof parsed?.address === "string"
        ? parsed.address.trim()
        : "";

    const name =
      rawName &&
      rawName !== "대한민국"
        ? rawName
        : undefined;

    const address =
      rawAddress &&
      rawAddress !== "대한민국"
        ? rawAddress
        : undefined;

    return {
      latitude,
      longitude,
      name,
      address,
    };
  } catch {
    return null;
  }
}


export default function FriendMapPage() {
  const router =
    useRouter();

  const [sessionId, setSessionId] =
    useState("");

  const [session, setSession] =
    useState<SessionResponse | null>(
      null
    );

  const [location, setLocation] =
    useState<LocationData | null>(
      null
    );

  const [locationQuery, setLocationQuery] =
    useState("");

  const [locationSearchResults, setLocationSearchResults] =
    useState<LocationSearchResult[]>([]);

  const [locationSearchLoading, setLocationSearchLoading] =
    useState(false);

  const [locationSearchError, setLocationSearchError] =
    useState("");

  const [places, setPlaces] =
    useState<RecommendedPlace[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [placeLoading, setPlaceLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [mapLoaded, setMapLoaded] =
    useState(false);

  const [completing, setCompleting] =
    useState(false);

  const mapElementRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const mapRef =
    useRef<NaverMapInstance | null>(
      null
    );

  const markersRef =
    useRef<NaverMarkerInstance[]>(
      []
    );

  const clientId =
    process.env
      .NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;


  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const id =
      params.get(
        "sessionId"
      ) ?? "";

    if (!id) {
      router.replace(
        "/friends"
      );
      return;
    }

    setSessionId(id);

    const storedLocation =
      getStoredLocation();

    setLocation(
      storedLocation
    );

    setLocationQuery(
      storedLocation?.name ?? ""
    );
  }, [router]);


  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const controller =
      new AbortController();

    async function loadSession() {
      try {
        setLoading(true);
        setError("");

        const response =
          await fetch(
            `/api/friend-recommendations/${sessionId}`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            }
          );

        if (
          response.status === 401
        ) {
          router.replace(
            "/login"
          );
          return;
        }

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ??
              "공통메뉴 추천을 불러오지 못했습니다."
          );
        }

        if (
          !controller.signal.aborted
        ) {
          setSession(result);
        }

      } catch (loadError) {
        if (
          !controller.signal.aborted
        ) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "공통메뉴 추천을 불러오지 못했습니다."
          );
        }
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    void loadSession();

    return () =>
      controller.abort();
  }, [sessionId, router]);


  async function searchBaseLocation(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const query =
      locationQuery.trim();

    if (!query) {
      setLocationSearchError(
        "검색할 장소를 입력해주세요."
      );
      return;
    }

    try {
      setLocationSearchLoading(true);
      setLocationSearchError("");
      setLocationSearchResults([]);

      const params =
        new URLSearchParams({
          query,
        });

      if (location) {
        params.set(
          "latitude",
          String(location.latitude)
        );
        params.set(
          "longitude",
          String(location.longitude)
        );
      }

      const response =
        await fetch(
          `/api/location-search?${params.toString()}`,
          {
            cache: "no-store",
          }
        );

      const result =
        (await response.json()) as
          LocationSearchResponse;

      if (!response.ok) {
        throw new Error(
          result.message ??
            "장소 검색에 실패했습니다."
        );
      }

      const results =
        result.results ?? [];

      if (results.length === 0) {
        setLocationSearchError(
          `"${query}" 검색 결과가 없습니다.`
        );
        return;
      }

      setLocationSearchResults(
        results.slice(0, 8)
      );
    } catch (searchError) {
      setLocationSearchError(
        searchError instanceof Error
          ? searchError.message
          : "장소 검색 중 오류가 발생했습니다."
      );
    } finally {
      setLocationSearchLoading(false);
    }
  }


  function selectBaseLocation(
    result: LocationSearchResult
  ) {
    const address =
      result.roadAddress ||
      result.jibunAddress;

    const nextLocation: LocationData = {
      latitude:
        result.latitude,
      longitude:
        result.longitude,
      name:
        result.name,
      address,
    };

    localStorage.setItem(
      "jummechu_location",
      JSON.stringify({
        ...nextLocation,
        source:
          "friend-place-search",
      })
    );

    setLocation(nextLocation);
    setLocationQuery(
      result.name
    );
    setLocationSearchResults([]);
    setLocationSearchError("");
    setPlaces([]);

    if (
      window.naver &&
      mapRef.current
    ) {
      const position =
        new window.naver.maps.LatLng(
          result.latitude,
          result.longitude
        );

      mapRef.current.setCenter(
        position
      );
      mapRef.current.setZoom(15);
    }
  }


  useEffect(() => {
    if (
      !session ||
      !location ||
      !sessionId
    ) {
      return;
    }

    const activeLocation =
      location;

    const controller =
      new AbortController();

    async function loadPlaces() {
      try {
        setPlaceLoading(true);
        setError("");
        setPlaces([]);

        /*
         * 친구 지도도 개인 지도와 같은 음식점 검색 파이프라인을 사용합니다.
         *
         * 브라우저에서 메뉴별 /api/location-search를 여러 번 호출하지 않고,
         * 서버의 /api/restaurants/friend 한 번으로 처리합니다.
         *
         * 서버 내부 순서:
         * 1) 두 사용자 embedding + anchor + MMR로 공통 메뉴 생성
         * 2) 기준 좌표를 행정구역으로 변환
         * 3) 개인 추천과 동일한 NAVER Local Search 방식으로 후보 수집
         * 4) 실제 거리 5km 필터
         * 5) 공통 취향 70% + 거리 30% 점수 계산
         */
        const params =
          new URLSearchParams({
            sessionId,
            latitude:
              String(
                activeLocation.latitude
              ),
            longitude:
              String(
                activeLocation.longitude
              ),
            radiusKm: "5",
          });

        const response =
          await fetch(
            `/api/restaurants/friend?${params.toString()}`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            }
          );

        const result =
          await response.json();

        if (
          response.status === 401
        ) {
          router.replace(
            "/login"
          );
          return;
        }

        if (!response.ok) {
          throw new Error(
            result.message ??
              "주변 음식점을 불러오지 못했습니다."
          );
        }

        if (
          !controller.signal.aborted
        ) {
          setPlaces(
            Array.isArray(
              result.restaurants
            )
              ? result.restaurants
              : []
          );

          if (result.message) {
            setError(
              result.message
            );
          }
        }

      } catch (placeError) {
        if (
          !controller.signal.aborted
        ) {
          setError(
            placeError instanceof Error
              ? placeError.message
              : "주변 음식점을 불러오지 못했습니다."
          );
        }
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setPlaceLoading(false);
        }
      }
    }

    void loadPlaces();

    return () =>
      controller.abort();
  }, [session, sessionId, location, router]);


  useEffect(() => {
    if (
      !mapLoaded ||
      !location ||
      !mapElementRef.current ||
      !window.naver
    ) {
      return;
    }

    const current =
      new window.naver.maps.LatLng(
        location.latitude,
        location.longitude
      );

    if (!mapRef.current) {
      mapRef.current =
        new window.naver.maps.Map(
          mapElementRef.current,
          {
            center: current,
            zoom: 15,
          }
        );
    }

    markersRef.current.forEach(
      (marker) =>
        marker.setMap(null)
    );

    markersRef.current = [];

    const map =
      mapRef.current;

    const bounds =
      new window.naver.maps.LatLngBounds(
        current,
        current
      );

    const myMarker =
      new window.naver.maps.Marker({
        position: current,
        map,
        zIndex: 9999,
        icon: {
          content: `
            <div style="
              width:22px;
              height:22px;
              border-radius:50%;
              background:#2563eb;
              border:4px solid #ffffff;
              box-shadow:0 2px 8px rgba(37,99,235,.45);
              box-sizing:border-box;
            "></div>
          `,
          size:
            new window.naver.maps.Size(
              22,
              22
            ),
          anchor:
            new window.naver.maps.Point(
              11,
              11
            ),
        },
      });

    markersRef.current.push(
      myMarker
    );

    places.forEach(
      (place) => {
        const position =
          new window.naver!.maps.LatLng(
            place.latitude,
            place.longitude
          );

        bounds.extend(
          position
        );

        const size =
          place.finalScore >= 85
            ? 50
            : place.finalScore >= 70
              ? 44
              : 38;

        const marker =
          new window.naver!.maps.Marker({
            position,
            map,
            zIndex:
              place.finalScore,
            icon: {
              content: `
                <div
                  title="${escapeHtml(place.name)}"
                  style="
                    width:${size}px;
                    height:${size}px;
                    border-radius:50%;
                    background:#f97316;
                    border:4px solid #fff;
                    box-shadow:0 4px 12px rgba(0,0,0,.25);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    color:#fff;
                    font-size:12px;
                    font-weight:800;
                    box-sizing:border-box;
                  "
                >
                  ${place.finalScore}
                </div>
              `,
              size:
                new window.naver!.maps.Size(
                  size,
                  size
                ),
              anchor:
                new window.naver!.maps.Point(
                  size / 2,
                  size / 2
                ),
            },
          });

        markersRef.current.push(
          marker
        );
      }
    );

    if (
      places.length > 0
    ) {
      map.fitBounds(
        bounds
      );
    } else {
      map.setCenter(
        current
      );
      map.setZoom(15);
    }

    return () => {
      markersRef.current.forEach(
        (marker) =>
          marker.setMap(null)
      );

      markersRef.current = [];
    };
  }, [
    mapLoaded,
    location,
    places,
  ]);


  async function completeSession() {
    if (!sessionId || completing) {
      return;
    }

    try {
      setCompleting(true);
      setError("");

      const response = await fetch(
        `/api/friend-recommendations/${sessionId}/complete`,
        { method: "POST" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ??
            "같이 먹기 완료 처리에 실패했습니다."
        );
      }

      router.push("/friends/history");
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : "같이 먹기 완료 처리에 실패했습니다."
      );
    } finally {
      setCompleting(false);
    }
  }


  const topMenus =
    useMemo(
      () =>
        session?.recommendations
          .slice(0, 8) ?? [],
      [session]
    );


  return (
    <>
      {clientId && (
        <Script
          id="naver-maps-friend-sdk"
          src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`}
          strategy="afterInteractive"
          onLoad={() =>
            setMapLoaded(true)
          }
          onReady={() =>
            setMapLoaded(true)
          }
          onError={() =>
            setError(
              "NAVER 지도 스크립트를 불러오지 못했습니다."
            )
          }
        />
      )}

      <main className="min-h-screen bg-[#f8f7f3]">
        <div className="mx-auto min-h-screen max-w-md bg-white shadow-sm">

          <header className="grid grid-cols-[52px_1fr_52px] items-center border-b border-gray-100 px-4 py-4">
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/friends"
                )
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
              aria-label="친구 페이지로 돌아가기"
            >
              ←
            </button>

            <div className="min-w-0 text-center">
              <p className="text-[10px] font-extrabold text-orange-500">
                FRIEND MATCH
              </p>

              <h1 className="truncate text-base font-extrabold text-gray-900">
                {session
                  ? `${session.me.name} × ${session.friend.name}`
                  : "공통메뉴 추천"}
              </h1>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/map"
                )
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-gray-500 transition hover:bg-gray-100"
              aria-label="개인 지도"
              title="개인 지도"
            >
              🗺️
            </button>
          </header>


          {loading ? (
            <div className="flex min-h-[70vh] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />
                <p className="mt-4 text-sm text-gray-500">
                  두 사람의 취향을 합치는 중...
                </p>
              </div>
            </div>
          ) : error && !session ? (
            <div className="p-5">
              <div className="rounded-3xl bg-red-50 p-5 text-sm leading-6 text-red-600">
                {error}
              </div>
            </div>
          ) : session ? (
            <>
              {session.session.status === "COMPLETED" && (
                <section className="border-b border-gray-100 px-4 py-3">
                  <div className="flex items-center justify-between rounded-2xl bg-gray-100 px-4 py-3">
                    <div>
                      <p className="text-xs font-extrabold text-gray-700">
                        ✓ 완료된 같이 먹기
                      </p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        히스토리에서 다시 보는 중이에요.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/friends/history")}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-gray-600 shadow-sm"
                    >
                      히스토리
                    </button>
                  </div>
                </section>
              )}

              <section className="border-b border-gray-100 px-4 py-4">
                <div className="rounded-3xl bg-gray-900 p-5 text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold text-orange-300">
                        👥 둘이 같이 좋아할 메뉴
                      </p>

                      <h2 className="mt-2 text-xl font-extrabold">
                        공통 취향을 기준으로 찾았어요
                      </h2>

                      <p className="mt-2 text-xs leading-5 text-white/60">
                        두 사람 평균뿐 아니라 낮은 쪽의 취향도 함께 반영해서 한 사람만 좋아하는 메뉴가 과하게 올라오지 않게 했어요.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {topMenus.map(
                      (menu, index) => (
                        <div
                          key={menu.id}
                          className={`rounded-full px-3 py-2 text-xs font-extrabold ${
                            index === 0
                              ? "bg-orange-500 text-white"
                              : "bg-white/10 text-white"
                          }`}
                        >
                          {menu.bothFavorite
                            ? "♥ "
                            : ""}
                          {menu.name}
                          <span className="ml-1 opacity-60">
                            {menu.score}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </section>


              <section className="border-b border-gray-100 px-4 py-4">
                <div className="rounded-3xl border border-orange-100 bg-orange-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold text-gray-900">
                        📍 어디 주변에서 먹을까요?
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-gray-500">
                        역, 학교, 회사, 동네, 건물명을 검색하면 그 장소 기준 5km 안에서 공통메뉴 식당을 찾아요.
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={searchBaseLocation}
                    className="mt-3 flex gap-2"
                  >
                    <input
                      value={locationQuery}
                      onChange={(event) =>
                        setLocationQuery(
                          event.target.value
                        )
                      }
                      placeholder="예: 충남대학교, 둔산동, 대전시청"
                      maxLength={200}
                      className="min-w-0 flex-1 rounded-xl border border-orange-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                      aria-label="공통메뉴 추천 기준 장소 검색"
                    />

                    <button
                      type="submit"
                      disabled={
                        locationSearchLoading ||
                        !locationQuery.trim()
                      }
                      className="rounded-xl bg-orange-500 px-4 text-sm font-extrabold text-white disabled:opacity-40"
                    >
                      {locationSearchLoading
                        ? "검색 중"
                        : "검색"}
                    </button>
                  </form>

                  {locationSearchError && (
                    <p className="mt-2 text-xs text-red-500">
                      {locationSearchError}
                    </p>
                  )}

                  {locationSearchResults.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                      {locationSearchResults.map(
                        (result) => (
                          <button
                            key={`${result.id}-${result.latitude}-${result.longitude}`}
                            type="button"
                            onClick={() =>
                              selectBaseLocation(
                                result
                              )
                            }
                            className="block w-full border-b border-gray-100 px-3 py-3 text-left last:border-b-0 hover:bg-orange-50"
                          >
                            <span className="block text-sm font-extrabold text-gray-800">
                              {result.name}
                            </span>
                            <span className="mt-1 block text-xs text-gray-500">
                              {result.roadAddress ||
                                result.jibunAddress ||
                                result.category}
                            </span>
                            <span className="mt-1 block text-[11px] font-bold text-orange-500">
                              {result.source === "local"
                                ? "장소"
                                : "지역"}
                              {result.distance !== null
                                ? ` · ${
                                    result.distance < 1000
                                      ? `${result.distance}m`
                                      : `${(result.distance / 1000).toFixed(1)}km`
                                  }`
                                : ""}
                            </span>
                          </button>
                        )
                      )}
                    </div>
                  )}

                  {location && (
                    <div className="mt-3 rounded-2xl bg-white px-3 py-3">
                      <p className="text-[11px] font-bold text-orange-500">
                        현재 추천 기준
                      </p>
                      <p className="mt-1 text-sm font-extrabold text-gray-900">
                        {location.name ||
                          "저장된 기준 위치"}
                      </p>
                      {location.address && (
                        <p className="mt-1 text-xs text-gray-500">
                          {location.address}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-gray-400">
                        이 장소에서 5km 이내만 추천해요.
                      </p>
                    </div>
                  )}
                </div>
              </section>


              {!location ? (
                <section className="p-4">
                  <div className="rounded-3xl bg-gray-50 p-6 text-center">
                    <div className="text-4xl">📍</div>
                    <p className="mt-3 font-extrabold text-gray-900">
                      위에서 장소를 검색해주세요
                    </p>
                    <p className="mt-2 text-sm leading-6 text-gray-500">
                      장소를 선택하면 두 사람의 공통메뉴와 그 주변 음식점을 바로 추천해요.
                    </p>
                  </div>
                </section>
              ) : (
                <>
                  <section className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-extrabold text-gray-800">
                          {location.name
                            ? `${location.name} 주변 추천`
                            : "선택 위치 주변 추천"}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-500">
                          공통 취향 70% · 거리 30% · 반경 5km
                        </p>
                      </div>

                      <span className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-extrabold text-orange-500">
                        {places.length}곳
                      </span>
                    </div>
                  </section>


                  <section className="relative h-[460px] bg-gray-100">
                    <div
                      ref={mapElementRef}
                      className="h-full w-full"
                    />

                    {(!mapLoaded || placeLoading) && (
                      <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-100/90">
                        <div className="text-center">
                          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />
                          <p className="mt-3 text-sm text-gray-500">
                            {location.name || "선택한 장소"} 주변 식당을 찾는 중...
                          </p>
                        </div>
                      </div>
                    )}
                  </section>


                  {error && (
                    <div className="mx-4 mt-4 rounded-2xl bg-red-50 px-4 py-3 text-xs leading-5 text-red-500">
                      {error}
                    </div>
                  )}


                  <section className="px-4 py-5">
                    <div className="mb-4">
                      <h2 className="text-lg font-extrabold text-gray-900">
                        둘이 같이 가기 좋은 곳
                      </h2>

                      <p className="mt-1 text-xs text-gray-500">
                        {location.name || "선택 위치"}에서 5km 이내의 식당만, 공통메뉴 적합도와 거리를 함께 반영했어요.
                      </p>
                    </div>

                    {places.length === 0 && !placeLoading ? (
                      <div className="rounded-3xl bg-gray-50 p-8 text-center">
                        <div className="text-4xl">
                          🍽️
                        </div>

                        <p className="mt-3 text-sm font-bold text-gray-700">
                          이 장소 주변에서 추천 후보를 찾지 못했어요.
                        </p>

                        <p className="mt-2 text-xs leading-5 text-gray-400">
                          공통 취향 메뉴와 메뉴 계열까지 검색했지만 5km 안에 후보가 없었어요. 다른 장소를 선택해보세요.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {places.map(
                          (place, index) => (
                            <article
                              key={`${place.id}-${index}`}
                              className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-orange-500 px-2 text-xs font-extrabold text-white">
                                      {place.finalScore}
                                    </span>

                                    <h3 className="truncate font-extrabold text-gray-900">
                                      {place.name}
                                    </h3>
                                  </div>

                                  <p className="mt-2 truncate text-xs text-gray-400">
                                    {place.category}
                                  </p>
                                </div>

                                <span className="shrink-0 text-xs font-bold text-gray-500">
                                  {place.distance === null
                                    ? "거리 미확인"
                                    : place.distance < 1000
                                      ? `${place.distance}m`
                                      : `${(place.distance / 1000).toFixed(1)}km`}
                                </span>
                              </div>

                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {getMenuMatchConfidenceMeta(
                                  place
                                ) && (
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                      getMenuMatchConfidenceMeta(
                                        place
                                      )!.className
                                    }`}
                                  >
                                    {getMenuMatchConfidenceMeta(
                                      place
                                    )!.label}
                                  </span>
                                )}

                                {place.matchedMenus.map(
                                  (menu) => (
                                    <span
                                      key={menu}
                                      className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-600"
                                    >
                                      {menu}
                                    </span>
                                  )
                                )}
                              </div>

                              {place.menuMatchConfidence ===
                                "broad" && (
                                <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-700">
                                  넓은 메뉴 계열로 찾은 후보예요. 실제 공통 추천 메뉴 판매 여부는 네이버 메뉴판에서 확인해주세요.
                                </p>
                              )}

                              <p className="mt-3 text-xs leading-5 text-gray-500">
                                {place.roadAddress ||
                                  place.jibunAddress}
                              </p>

                              <a
                                href={`https://map.naver.com/p/search/${encodeURIComponent(place.name)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white"
                              >
                                네이버 지도에서 보기
                              </a>
                            </article>
                          )
                        )}
                      </div>
                    )}
                  </section>

                  {session.session.status === "ACCEPTED" && (
                    <section className="border-t border-gray-100 px-4 py-5">
                      <button
                        type="button"
                        onClick={completeSession}
                        disabled={completing}
                        className="w-full rounded-2xl bg-gray-900 py-4 text-sm font-extrabold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {completing
                          ? "완료 처리 중..."
                          : "같이 먹기 완료"}
                      </button>
                      <p className="mt-2 text-center text-[11px] text-gray-400">
                        완료하면 이 추천은 히스토리로 이동해요.
                      </p>
                    </section>
                  )}
                </>
              )}
            </>
          ) : null}

        </div>
      </main>
    </>
  );
}
