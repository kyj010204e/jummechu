"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

/* =========================================================
   타입
========================================================= */

type SearchResult = {
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

type SearchResponse = {
  query?: string;

  center?: {
    latitude: number;
    longitude: number;
  } | null;

  results?: SearchResult[];

  message?: string;
};

/* =========================================================
   거리 표시
========================================================= */

function formatDistance(distance: number | null) {
  if (distance === null) {
    return "";
  }

  if (distance < 1000) {
    return `${Math.round(distance)}m`;
  }

  return `${(distance / 1000).toFixed(1)}km`;
}

/* =========================================================
   PAGE
========================================================= */

export default function LocationPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState("");

  const [query, setQuery] = useState("");

  const [searchLoading, setSearchLoading] =
    useState(false);

  const [searchError, setSearchError] =
    useState("");

  const [searchResults, setSearchResults] =
    useState<SearchResult[]>([]);

  /* =======================================================
     현재 위치 자동 찾기
  ======================================================= */

  const requestLocation = () => {
    setLocationError("");
    setSearchError("");

    if (!navigator.geolocation) {
      setLocationError(
        "현재 브라우저에서는 위치 정보를 사용할 수 없습니다."
      );

      return;
    }

    setLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        const accuracy =
          position.coords.accuracy;

        console.log("위도:", latitude);
        console.log("경도:", longitude);
        console.log("오차:", accuracy, "m");

        /*
         * 데스크톱 환경에서 위치 오차가 너무 큰 경우
         * 잘못된 좌표를 저장하지 않음
         */
        if (accuracy > 5000) {
          setLoading(false);

          setLocationError(
            `현재 위치의 오차 범위가 약 ${Math.round(
              accuracy / 1000
            )}km입니다. 아래 장소 검색을 이용해주세요.`
          );

          return;
        }

        localStorage.setItem(
          "jummechu_location",
          JSON.stringify({
            latitude,
            longitude,
            accuracy,
            source: "geolocation",
            name: "현재 위치",
          })
        );

        setLoading(false);

        router.push("/map");
      },

      (error) => {
        setLoading(false);

        console.error(
          "Geolocation error:",
          error
        );

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError(
              "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용하거나 아래 장소 검색을 이용해주세요."
            );
            break;

          case error.POSITION_UNAVAILABLE:
            setLocationError(
              "현재 위치를 확인할 수 없습니다. 아래 장소 검색을 이용해주세요."
            );
            break;

          case error.TIMEOUT:
            setLocationError(
              "위치 확인 시간이 초과되었습니다. 다시 시도하거나 아래 장소 검색을 이용해주세요."
            );
            break;

          default:
            setLocationError(
              "위치 정보를 가져오는 중 문제가 발생했습니다."
            );
        }
      },

      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  };

  /* =======================================================
     현재 검색 기준 위치 읽기
  ======================================================= */

  const getReferenceLocation = () => {
    const savedLocation =
      localStorage.getItem(
        "jummechu_location"
      );

    if (!savedLocation) {
      return null;
    }

    try {
      const parsed =
        JSON.parse(savedLocation);

      if (
        typeof parsed.latitude ===
          "number" &&
        typeof parsed.longitude ===
          "number"
      ) {
        return {
          latitude:
            parsed.latitude,

          longitude:
            parsed.longitude,
        };
      }
    } catch {
      console.error(
        "저장된 검색 기준 위치를 읽지 못했습니다."
      );
    }

    return null;
  };

  /* =======================================================
     장소 검색
  ======================================================= */

  const searchPlace = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const trimmedQuery =
      query.trim();

    if (!trimmedQuery) {
      setSearchError(
        "장소명이나 건물명을 입력해주세요."
      );

      return;
    }

    try {
      setSearchLoading(true);

      setSearchError("");
      setLocationError("");
      setSearchResults([]);

      const params =
        new URLSearchParams({
          query:
            trimmedQuery,
        });

      /*
       * 기존 검색 기준 위치를 함께 보내서
       * 가까운 장소부터 정렬
       */
      const referenceLocation =
        getReferenceLocation();

      if (referenceLocation) {
        params.set(
          "latitude",
          String(
            referenceLocation.latitude
          )
        );

        params.set(
          "longitude",
          String(
            referenceLocation.longitude
          )
        );
      }

      const response =
        await fetch(
          `/api/location-search?${params.toString()}`,
          {
            cache:
              "no-store",
          }
        );

      const data =
        (await response.json()) as SearchResponse;

      if (!response.ok) {
        throw new Error(
          data.message ??
            "장소 검색에 실패했습니다."
        );
      }

      const results =
        data.results ?? [];

      if (
        results.length ===
        0
      ) {
        setSearchError(
          `"${trimmedQuery}" 검색 결과가 없습니다. 다른 장소명이나 더 정확한 이름으로 검색해주세요.`
        );

        return;
      }

      setSearchResults(
        results
      );
    } catch (error) {
      console.error(error);

      if (
        error instanceof Error
      ) {
        setSearchError(
          error.message
        );
      } else {
        setSearchError(
          "장소 검색 중 문제가 발생했습니다."
        );
      }
    } finally {
      setSearchLoading(false);
    }
  };

  /* =======================================================
     검색 결과 선택
  ======================================================= */

  const selectLocation = (
    result: SearchResult
  ) => {
    /*
     * 선택한 장소를 새 검색 기준 위치로 저장
     *
     * /map에서 파란 동그라미 위치가 이 좌표가 되고,
     * 이후 위치 저장을 누르면 우리집/회사 등으로 저장 가능
     */
    localStorage.setItem(
      "jummechu_location",
      JSON.stringify({
        latitude:
          result.latitude,

        longitude:
          result.longitude,

        source:
          "place-search",

        name:
          result.name,

        category:
          result.category,

        address:
          result.roadAddress ||
          result.jibunAddress,

        roadAddress:
          result.roadAddress,

        jibunAddress:
          result.jibunAddress,
      })
    );

    router.push("/map");
  };

  /* =======================================================
     JSX
  ======================================================= */

  return (
    <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

      <div className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-md flex-col">

        {/* =================================================
            상단
        ================================================= */}

        <header>
          <button
            type="button"
            onClick={() =>
              router.back()
            }
            className="flex h-8 w-8 items-center justify-center text-2xl text-gray-700"
            aria-label="뒤로가기"
          >
            ‹
          </button>
        </header>

        {/* =================================================
            메인
        ================================================= */}

        <section className="flex flex-1 flex-col items-center pt-10 text-center">

          {/* 아이콘 */}

          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[26px] bg-orange-50 shadow-sm">

            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">
              <span className="text-3xl">
                📍
              </span>
            </div>

          </div>

          {/* 제목 */}

          <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-gray-900">
            어디에서
            <br />
            점심을 찾을까요?
          </h1>

          <p className="mt-4 text-sm leading-6 text-gray-500">
            현재 위치를 사용하거나
            <br />
            건물명·아파트명·장소명을 검색해보세요.
          </p>

          {/* =================================================
              현재 위치
          ================================================= */}

          <button
            type="button"
            onClick={
              requestLocation
            }
            disabled={loading}
            className="mt-8 flex w-full items-center rounded-2xl bg-white px-5 py-4 text-left shadow-sm transition hover:shadow-md disabled:cursor-wait disabled:opacity-60"
          >

            <div className="mr-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50">

              <span className="h-4 w-4 rounded-full border-[3px] border-white bg-blue-600 shadow-sm" />

            </div>

            <div className="flex-1">

              <p className="text-sm font-bold text-gray-800">
                {loading
                  ? "현재 위치 확인 중..."
                  : "현재 위치로 찾기"}
              </p>

              <p className="mt-1 text-xs text-gray-400">
                내 위치를 검색 기준으로 설정해요.
              </p>

            </div>

            <span className="text-gray-300">
              ›
            </span>

          </button>

          {/* 위치 오류 */}

          {locationError && (
            <div className="mt-4 w-full rounded-xl bg-red-50 px-4 py-3 text-left">

              <p className="text-xs leading-5 text-red-500">
                {locationError}
              </p>

            </div>
          )}

          {/* =================================================
              구분선
          ================================================= */}

          <div className="my-6 flex w-full items-center gap-3">

            <div className="h-px flex-1 bg-gray-200" />

            <span className="text-xs text-gray-400">
              또는 장소 검색
            </span>

            <div className="h-px flex-1 bg-gray-200" />

          </div>

          {/* =================================================
              장소 검색
          ================================================= */}

          <div className="w-full text-left">

            <div className="mb-3">

              <p className="text-sm font-bold text-gray-800">
                장소를 검색해보세요
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-400">
                같은 이름의 장소가 여러 개면 현재 검색 기준 위치에서 가까운 곳부터 보여드려요.
              </p>

            </div>

            {/* 검색 폼 */}

            <form
              onSubmit={
                searchPlace
              }
              className="flex gap-2"
            >

              <div className="relative min-w-0 flex-1">

                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                  🔍
                </span>

                <input
                  type="text"
                  value={query}
                  onChange={(
                    event
                  ) => {
                    setQuery(
                      event.target.value
                    );

                    if (
                      searchError
                    ) {
                      setSearchError(
                        ""
                      );
                    }
                  }}
                  placeholder="예: 녹원아파트"
                  className="w-full rounded-xl border border-gray-200 bg-white py-3.5 pl-10 pr-10 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
                />

                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSearchResults([]);
                      setSearchError("");
                    }}
                    className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-xs text-gray-400 hover:bg-gray-100"
                    aria-label="검색어 지우기"
                  >
                    ✕
                  </button>
                )}

              </div>

              <button
                type="submit"
                disabled={
                  searchLoading
                }
                className="shrink-0 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-wait disabled:opacity-60"
              >
                {searchLoading
                  ? "검색 중"
                  : "검색"}
              </button>

            </form>

            {/* 검색 예시 */}

            {searchResults.length ===
              0 &&
              !searchLoading && (
              <div className="mt-3 flex flex-wrap gap-2">

                {[
                  "녹원아파트",
                  "갤러리아 타임월드",
                  "시청",
                ].map(
                  (example) => (
                    <button
                      key={
                        example
                      }
                      type="button"
                      onClick={() =>
                        setQuery(
                          example
                        )
                      }
                      className="rounded-full bg-white px-3 py-2 text-[11px] font-medium text-gray-500 shadow-sm ring-1 ring-gray-100 transition hover:bg-orange-50 hover:text-orange-500"
                    >
                      {example}
                    </button>
                  )
                )}

              </div>
            )}

            {/* 검색 오류 */}

            {searchError && (
              <div className="mt-3 rounded-xl bg-red-50 px-4 py-3">

                <p className="text-xs leading-5 text-red-500">
                  {searchError}
                </p>

              </div>
            )}

            {/* 검색 중 */}

            {searchLoading && (
              <div className="mt-5 rounded-2xl bg-white px-5 py-8 text-center shadow-sm">

                <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />

                <p className="text-sm text-gray-500">
                  가까운 장소부터 찾고 있어요...
                </p>

              </div>
            )}

            {/* =================================================
                검색 결과
            ================================================= */}

            {!searchLoading &&
              searchResults.length >
                0 && (
              <div className="mt-5">

                <div className="mb-2 flex items-center justify-between">

                  <p className="text-xs font-semibold text-gray-500">
                    검색 결과
                  </p>

                  <span className="text-[11px] text-gray-400">
                    가까운 순 · {searchResults.length}개
                  </span>

                </div>

                <div className="max-h-[380px] overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-sm">

                  {searchResults.map(
                    (
                      result,
                      index
                    ) => (
                      <button
                        key={
                          result.id
                        }
                        type="button"
                        onClick={() =>
                          selectLocation(
                            result
                          )
                        }
                        className={`flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-orange-50 ${
                          index !==
                          searchResults.length -
                            1
                            ? "border-b border-gray-100"
                            : ""
                        }`}
                      >

                        {/* 번호/아이콘 */}

                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-xs font-bold text-orange-500">
                          {index + 1}
                        </div>

                        {/* 장소 정보 */}

                        <div className="min-w-0 flex-1">

                          <div className="flex items-start justify-between gap-3">

                            <div className="min-w-0">

                              <p className="truncate text-sm font-bold text-gray-900">
                                {result.name}
                              </p>

                              {result.category && (
                                <p className="mt-0.5 truncate text-[11px] text-gray-400">
                                  {result.category}
                                </p>
                              )}

                            </div>

                            {result.distance !==
                              null && (
                              <span className="shrink-0 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-500">
                                {formatDistance(
                                  result.distance
                                )}
                              </span>
                            )}

                          </div>

                          {/* 도로명 주소 */}

                          {result.roadAddress && (
                            <p className="mt-2 text-xs leading-5 text-gray-700">
                              {result.roadAddress}
                            </p>
                          )}

                          {/* 지번 주소 */}

                          {result.jibunAddress &&
                            result.jibunAddress !==
                              result.roadAddress && (
                            <p className="mt-0.5 text-[11px] leading-5 text-gray-400">
                              {result.jibunAddress}
                            </p>
                          )}

                        </div>

                        <span className="mt-2 text-gray-300">
                          ›
                        </span>

                      </button>
                    )
                  )}

                </div>

                <p className="mt-3 text-center text-[11px] leading-5 text-gray-400">
                  원하는 장소를 누르면 지도에서 해당 위치로 이동하고
                  <br />
                  우리집·회사 같은 위치로 저장할 수 있어요.
                </p>

              </div>
            )}

          </div>

        </section>

        {/* =================================================
            하단 안내
        ================================================= */}

        <section className="pb-3 pt-8">

          <p className="text-center text-[11px] leading-5 text-gray-400">
            위치 정보는 주변 음식점을 찾는 용도로만 사용되며
            <br />
            서비스 이용에 필요한 경우에만 활용됩니다.
          </p>

        </section>

      </div>

    </main>
  );
}
