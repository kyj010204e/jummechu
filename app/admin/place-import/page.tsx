"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";


type ParsedBusinessHour = {
  dayOfWeek: number;

  dayName: string;

  isClosed: boolean;

  openTime: string | null;

  closeTime: string | null;

  breakStartTime:
    string | null;

  breakEndTime:
    string | null;

  raw: string;
};


type ParsedMenuPrice = {
  name: string;

  priceKrw: number;

  raw: string;
};


type ParseResult = {
  businessHours:
    ParsedBusinessHour[];

  menus:
    ParsedMenuPrice[];

  warnings:
    string[];

  interestingLines:
    string[];
};


type ApiResponse = {
  success?: boolean;

  message?: string;

  parsed?:
    ParseResult;

  imported?: {
    businessHours:
      number;

    insertedPrices:
      number;

    updatedPrices:
      number;
  };
};


const DAY_NAMES = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
];


function formatPrice(
  value: number
) {

  return `${value.toLocaleString(
    "ko-KR"
  )}원`;
}


export default function PlaceImportPage() {

  const router =
    useRouter();


  const [
    authChecking,
    setAuthChecking,
  ] =
    useState(true);


  const [
    restaurantName,
    setRestaurantName,
  ] =
    useState("");


  const [
    roadAddress,
    setRoadAddress,
  ] =
    useState("");


  const [
    sourceUrl,
    setSourceUrl,
  ] =
    useState("");


  const [
    rawText,
    setRawText,
  ] =
    useState("");


  const [
    parsed,
    setParsed,
  ] =
    useState<
      ParseResult | null
    >(null);


  const [
    loading,
    setLoading,
  ] =
    useState(false);


  const [
    error,
    setError,
  ] =
    useState("");


  const [
    success,
    setSuccess,
  ] =
    useState("");


  useEffect(() => {

    let cancelled =
      false;


    async function checkAdmin() {

      try {

        const response =
          await fetch(
            "/api/admin/place-import",
            {
              cache:
                "no-store",
            }
          );


        if (
          response.status ===
          401
        ) {

          router.replace(
            "/login"
          );

          return;
        }


        if (
          response.status ===
          403
        ) {

          if (
            !cancelled
          ) {

            setError(
              "관리자 권한이 필요합니다."
            );
          }

          return;
        }


        if (
          !response.ok
        ) {

          throw new Error(
            "관리자 상태를 확인하지 못했습니다."
          );
        }


      } catch (checkError) {

        if (
          !cancelled
        ) {

          setError(
            checkError instanceof
              Error
              ? checkError.message
              : "관리자 상태를 확인하지 못했습니다."
          );
        }


      } finally {

        if (
          !cancelled
        ) {

          setAuthChecking(
            false
          );
        }
      }
    }


    void checkAdmin();


    return () => {
      cancelled =
        true;
    };

  }, [router]);


  const parsedDaySet =
    useMemo(
      () =>
        new Set(
          parsed
            ?.businessHours
            .map(
              (item) =>
                item.dayOfWeek
            ) ??
            []
        ),
      [parsed]
    );


  async function analyzeText() {

    if (
      loading
    ) {
      return;
    }


    try {

      setLoading(
        true
      );

      setError(
        ""
      );

      setSuccess(
        ""
      );


      const response =
        await fetch(
          "/api/admin/place-import",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "parse",

                rawText,
              }),
          }
        );


      const data =
        (
          await response.json()
        ) as ApiResponse;


      if (
        response.status ===
        401
      ) {

        router.replace(
          "/login"
        );

        return;
      }


      if (
        !response.ok
      ) {

        throw new Error(
          data.message ??
          "텍스트 분석에 실패했습니다."
        );
      }


      setParsed(
        data.parsed ??
        null
      );


    } catch (analyzeError) {

      setError(
        analyzeError instanceof
          Error
          ? analyzeError.message
          : "텍스트 분석에 실패했습니다."
      );


    } finally {

      setLoading(
        false
      );
    }
  }


  async function importData() {

    if (
      loading ||
      !parsed
    ) {
      return;
    }


    if (
      !restaurantName
        .trim()
    ) {

      setError(
        "음식점 이름을 입력해주세요."
      );

      return;
    }


    if (
      !roadAddress
        .trim()
    ) {

      setError(
        "음식점 도로명 주소를 입력해주세요."
      );

      return;
    }


    const confirmed =
      window.confirm(
        "미리보기의 영업시간과 메뉴 가격을 DB에 반영할까요?"
      );


    if (
      !confirmed
    ) {
      return;
    }


    try {

      setLoading(
        true
      );

      setError(
        ""
      );

      setSuccess(
        ""
      );


      const response =
        await fetch(
          "/api/admin/place-import",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "import",

                restaurantName:
                  restaurantName
                    .trim(),

                roadAddress:
                  roadAddress
                    .trim(),

                sourceUrl:
                  sourceUrl
                    .trim() ||
                  null,

                rawText,
              }),
          }
        );


      const data =
        (
          await response.json()
        ) as ApiResponse;


      if (
        response.status ===
        401
      ) {

        router.replace(
          "/login"
        );

        return;
      }


      if (
        !response.ok
      ) {

        throw new Error(
          data.message ??
          "DB 반영에 실패했습니다."
        );
      }


      setSuccess(
        data.message ??
        "DB 반영이 완료되었습니다."
      );


      if (
        data.parsed
      ) {

        setParsed(
          data.parsed
        );
      }


    } catch (importError) {

      setError(
        importError instanceof
          Error
          ? importError.message
          : "DB 반영에 실패했습니다."
      );


    } finally {

      setLoading(
        false
      );
    }
  }


  if (
    authChecking
  ) {

    return (
      <main className="min-h-screen bg-[#f8f7f3] px-5 py-20">

        <p className="text-center text-sm text-gray-500">
          관리자 권한 확인 중...
        </p>

      </main>
    );
  }


  return (
    <main className="min-h-screen bg-[#f8f7f3]">

      <div className="mx-auto min-h-screen max-w-3xl bg-white">

        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">

          <div className="flex items-center justify-between gap-3">

            <div>

              <p className="text-xs font-bold text-orange-500">
                JUMMECHU ADMIN
              </p>

              <h1 className="mt-1 text-xl font-bold text-gray-900">
                네이버 플레이스 정보 반영
              </h1>

            </div>


            <div className="flex gap-2">

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/admin"
                  )
                }
                className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600"
              >
                관리자
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/map"
                  )
                }
                className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-bold text-orange-600"
              >
                지도
              </button>

            </div>

          </div>

        </header>


        <section className="px-5 py-5">

          <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">

            <p className="text-sm font-bold text-orange-700">
              네이버 플레이스에서 직접 확인한 텍스트를 붙여넣어 주세요.
            </p>

            <p className="mt-1 text-xs leading-5 text-orange-600/80">
              프로그램이 네이버에 자동 접속하지 않고,
              붙여넣은 텍스트에서 영업시간과 메뉴 가격만 분석합니다.
            </p>

          </div>


          {error && (
            <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-500">
              {error}
            </div>
          )}


          {success && (
            <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-600">
              {success}
            </div>
          )}


          <div className="mt-5 grid gap-4">

            <label>

              <span className="text-xs font-bold text-gray-600">
                음식점 이름
              </span>

              <input
                type="text"
                value={
                  restaurantName
                }
                onChange={(event) =>
                  setRestaurantName(
                    event.target.value
                  )
                }
                placeholder="예: 별달돈까스 대전둔산점"
                className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-orange-400"
              />

            </label>


            <label>

              <span className="text-xs font-bold text-gray-600">
                도로명 주소
              </span>

              <input
                type="text"
                value={
                  roadAddress
                }
                onChange={(event) =>
                  setRoadAddress(
                    event.target.value
                  )
                }
                placeholder="추천 카드에 표시되는 주소와 동일하게 입력"
                className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-orange-400"
              />

            </label>


            <label>

              <span className="text-xs font-bold text-gray-600">
                네이버 플레이스 URL
                <span className="ml-1 font-normal text-gray-400">
                  (선택)
                </span>
              </span>

              <input
                type="url"
                value={
                  sourceUrl
                }
                onChange={(event) =>
                  setSourceUrl(
                    event.target.value
                  )
                }
                placeholder="https://map.naver.com/..."
                className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-orange-400"
              />

            </label>


            <label>

              <span className="text-xs font-bold text-gray-600">
                복사한 플레이스 텍스트
              </span>

              <textarea
                value={
                  rawText
                }
                onChange={(event) => {

                  setRawText(
                    event.target.value
                  );

                  setParsed(
                    null
                  );

                  setSuccess(
                    ""
                  );
                }}
                placeholder={`영업시간
오늘 휴무 매주 월요일 휴무

화
11:00 - 22:00

메뉴
돈가스
10,000원
치즈돈가스
12,000원`}
                className="mt-2 min-h-72 w-full resize-y rounded-2xl border border-gray-200 px-4 py-4 font-mono text-xs leading-6 outline-none focus:border-orange-400"
              />

            </label>

          </div>


          <button
            type="button"
            disabled={
              loading ||
              rawText.trim()
                .length <
                10
            }
            onClick={
              analyzeText
            }
            className="mt-4 w-full rounded-xl bg-gray-900 py-3.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            {loading
              ? "분석 중..."
              : "텍스트 분석"}
          </button>


          {parsed && (
            <div className="mt-7">

              <div className="flex items-center justify-between">

                <h2 className="text-lg font-bold text-gray-900">
                  분석 결과
                </h2>

                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-500">
                  영업 {parsed.businessHours.length} · 메뉴 {parsed.menus.length}
                </span>

              </div>


              {parsed.warnings.length >
                0 && (
                <div className="mt-4 rounded-2xl bg-amber-50 p-4">

                  <p className="text-xs font-bold text-amber-700">
                    확인 필요
                  </p>

                  <div className="mt-2 space-y-1">

                    {parsed.warnings.map(
                      (warning) => (
                        <p
                          key={
                            warning
                          }
                          className="text-xs text-amber-600"
                        >
                          • {warning}
                        </p>
                      )
                    )}

                  </div>

                </div>
              )}


              <div className="mt-5 rounded-3xl border border-gray-100 p-4">

                <h3 className="font-bold text-gray-900">
                  영업시간
                </h3>

                <div className="mt-3 space-y-2">

                  {DAY_NAMES.map(
                    (
                      dayName,
                      dayOfWeek
                    ) => {

                      const item =
                        parsed.businessHours.find(
                          (
                            hours
                          ) =>
                            hours.dayOfWeek ===
                            dayOfWeek
                        );


                      if (!item) {

                        return (
                          <div
                            key={
                              dayName
                            }
                            className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5"
                          >

                            <span className="text-xs font-bold text-gray-500">
                              {dayName}
                            </span>

                            <span className="text-xs text-gray-300">
                              정보 없음
                            </span>

                          </div>
                        );
                      }


                      return (
                        <div
                          key={
                            dayName
                          }
                          className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5"
                        >

                          <span className="text-xs font-bold text-gray-600">
                            {dayName}
                          </span>


                          {item.isClosed ? (
                            <span className="text-xs font-bold text-red-500">
                              정기휴무
                            </span>
                          ) : (
                            <div className="text-right">

                              <p className="text-xs font-bold text-emerald-600">
                                {item.openTime}
                                {" ~ "}
                                {item.closeTime}
                              </p>

                              {item.breakStartTime &&
                                item.breakEndTime && (
                                <p className="mt-0.5 text-[10px] font-semibold text-amber-600">
                                  브레이크{" "}
                                  {item.breakStartTime}
                                  {" ~ "}
                                  {item.breakEndTime}
                                </p>
                              )}

                            </div>
                          )}

                        </div>
                      );
                    }
                  )}

                </div>

              </div>


              <div className="mt-4 rounded-3xl border border-gray-100 p-4">

                <div className="flex items-center justify-between">

                  <h3 className="font-bold text-gray-900">
                    메뉴 가격
                  </h3>

                  <span className="text-xs text-gray-400">
                    {parsed.menus.length}개
                  </span>

                </div>


                {parsed.menus.length ===
                  0 ? (
                  <p className="mt-4 text-sm text-gray-400">
                    파싱된 메뉴가 없습니다.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100">

                    {parsed.menus.map(
                      (
                        menu,
                        index
                      ) => (
                        <div
                          key={`${menu.name}-${menu.priceKrw}-${index}`}
                          className="flex items-center justify-between gap-4 py-3"
                        >

                          <p className="truncate text-sm font-semibold text-gray-700">
                            {menu.name}
                          </p>

                          <p className="shrink-0 text-sm font-extrabold text-emerald-600">
                            {formatPrice(
                              menu.priceKrw
                            )}
                          </p>

                        </div>
                      )
                    )}

                  </div>
                )}

              </div>


              <div className="mt-4 rounded-2xl bg-blue-50 p-4">

                <p className="text-xs font-bold text-blue-700">
                  DB 반영 방식
                </p>

                <p className="mt-1 text-xs leading-5 text-blue-600">
                  영업시간은 해당 요일만 갱신하고,
                  메뉴 가격은 같은 가게·주소·메뉴가 있으면 갱신,
                  없으면 새로 추가합니다.
                </p>

              </div>


              <button
                type="button"
                disabled={
                  loading ||
                  (
                    parsed.businessHours
                      .length ===
                      0 &&
                    parsed.menus
                      .length ===
                      0
                  )
                }
                onClick={
                  importData
                }
                className="mt-5 w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white shadow-lg shadow-orange-100 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
              >
                {loading
                  ? "DB 반영 중..."
                  : "미리보기 그대로 일괄 반영"}
              </button>


              {parsedDaySet.size <
                7 && (
                <p className="mt-2 text-center text-[11px] text-gray-400">
                  정보가 없는 요일은 기존 DB 값을 삭제하지 않습니다.
                </p>
              )}

            </div>
          )}

        </section>

      </div>

    </main>
  );
}
