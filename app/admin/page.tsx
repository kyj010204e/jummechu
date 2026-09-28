"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";


type BusinessHoursReportGroup = {
  reportIds:
    string[];

  userId:
    string;

  reporterEmail:
    string;

  reporterName:
    string;

  restaurantKey:
    string;

  restaurantName:
    string;

  roadAddress:
    string;

  dayOfWeeks:
    number[];

  openTime:
    string | null;

  closeTime:
    string | null;

  breakStartTime:
    string | null;

  breakEndTime:
    string | null;

  isClosed:
    boolean;

  sourceUrl:
    string | null;

  status:
    string;

  createdAt:
    string;
};


type ReportsResponse = {
  reports?:
    BusinessHoursReportGroup[];

  count?: number;

  pendingRows?: number;

  message?: string;
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


export default function AdminPage() {

  const router =
    useRouter();


  const [
    reports,
    setReports,
  ] =
    useState<
      BusinessHoursReportGroup[]
    >([]);


  const [
    pendingRows,
    setPendingRows,
  ] =
    useState(0);


  const [
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    error,
    setError,
  ] =
    useState("");


  const [
    processingKey,
    setProcessingKey,
  ] =
    useState<
      string | null
    >(null);


  const [
    reviewNotes,
    setReviewNotes,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});


  function getGroupKey(
    report:
      BusinessHoursReportGroup
  ) {

    return report.reportIds
      .join(
        "-"
      );
  }


  function getDaysLabel(
    dayOfWeeks:
      number[]
  ) {

    const normalized =
      [...dayOfWeeks]
        .sort(
          (
            a,
            b
          ) =>
            a - b
        );


    if (
      normalized.length ===
        7 &&
      normalized.every(
        (
          day,
          index
        ) =>
          day === index
      )
    ) {

      return "매일";
    }


    return normalized
      .map(
        (day) =>
          DAY_NAMES[
            day
          ]
      )
      .join(
        " · "
      );
  }


  async function loadReports() {

    try {

      setLoading(
        true
      );

      setError(
        ""
      );


      const response =
        await fetch(
          "/api/admin/business-hours",
          {
            cache:
              "no-store",
          }
        );


      const data =
        (
          await response.json()
        ) as ReportsResponse;


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

        setError(
          "관리자 권한이 없습니다."
        );

        return;
      }


      if (
        !response.ok
      ) {

        throw new Error(
          data.message ??
          "제보 목록을 불러오지 못했습니다."
        );
      }


      setReports(
        data.reports ?? []
      );


      setPendingRows(
        data.pendingRows ?? 0
      );


    } catch (loadError) {

      setError(
        loadError instanceof
          Error
          ? loadError.message
          : "제보 목록을 불러오지 못했습니다."
      );


    } finally {

      setLoading(
        false
      );
    }
  }


  useEffect(() => {

    void loadReports();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  async function reviewReport(
    report:
      BusinessHoursReportGroup,

    action:
      "approve" |
      "reject"
  ) {

    if (
      processingKey
    ) {
      return;
    }


    const groupKey =
      getGroupKey(
        report
      );


    try {

      setProcessingKey(
        groupKey
      );

      setError(
        ""
      );


      const response =
        await fetch(
          "/api/admin/business-hours",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                reportIds:
                  report.reportIds,

                action,

                reviewNote:
                  reviewNotes[
                    groupKey
                  ] ?? "",
              }),
          }
        );


      const data =
        await response.json();


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

        throw new Error(
          "관리자 권한이 없습니다."
        );
      }


      if (
        !response.ok
      ) {

        throw new Error(
          data.message ??
          "제보 처리에 실패했습니다."
        );
      }


      setReports(
        (current) =>
          current.filter(
            (item) =>
              getGroupKey(
                item
              ) !==
              groupKey
          )
      );


      setPendingRows(
        (current) =>
          Math.max(
            0,
            current -
              report.reportIds.length
          )
      );


      setReviewNotes(
        (current) => {

          const next = {
            ...current,
          };

          delete next[
            groupKey
          ];

          return next;
        }
      );


    } catch (reviewError) {

      setError(
        reviewError instanceof
          Error
          ? reviewError.message
          : "제보 처리에 실패했습니다."
      );


    } finally {

      setProcessingKey(
        null
      );
    }
  }


  function formatSubmittedAt(
    value: string
  ) {

    try {

      return new Intl.DateTimeFormat(
        "ko-KR",
        {
          timeZone:
            "Asia/Seoul",

          year:
            "numeric",

          month:
            "2-digit",

          day:
            "2-digit",

          hour:
            "2-digit",

          minute:
            "2-digit",
        }
      ).format(
        new Date(
          value
        )
      );

    } catch {

      return value;
    }
  }


  return (
    <main className="min-h-screen bg-[#f8f7f3]">

      <div className="mx-auto min-h-screen max-w-4xl bg-white">

        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">

          <div className="flex items-center justify-between gap-3">

            <div>
              <p className="text-xs font-bold text-orange-500">
                JUMMECHU ADMIN
              </p>

              <h1 className="mt-1 text-xl font-bold text-gray-900">
                영업시간 제보 관리
              </h1>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/map"
                )
              }
              className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-600"
            >
              지도
            </button>

          </div>

        </header>


        <section className="px-5 py-5">

          <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3">

            <p className="text-sm font-bold text-orange-700">
              승인된 제보만 실제 추천에 반영됩니다.
            </p>

            <p className="mt-1 text-xs leading-5 text-orange-600/80">
              한 번에 여러 요일을 제보한 경우 하나의 카드로 묶어서 승인하거나 거절할 수 있어요.
            </p>

          </div>


          {error && (
            <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-500">
              {error}
            </div>
          )}


          {loading && (
            <div className="py-16 text-center">

              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />

              <p className="text-sm text-gray-500">
                제보를 불러오는 중...
              </p>

            </div>
          )}


          {!loading &&
            !error && (
              <div className="mt-5 flex items-end justify-between gap-3">

                <div>

                  <h2 className="text-lg font-bold text-gray-900">
                    승인 대기
                  </h2>

                  {pendingRows >
                    reports.length && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      요일별 데이터 {pendingRows}개를 제보 {reports.length}건으로 묶어 표시 중
                    </p>
                  )}

                </div>

                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-500">
                  {reports.length}건
                </span>

              </div>
            )}


          {!loading &&
            !error &&
            reports.length ===
              0 && (
              <div className="mt-5 rounded-2xl bg-gray-50 p-8 text-center">

                <p className="font-bold text-gray-700">
                  대기 중인 제보가 없어요.
                </p>

                <p className="mt-1 text-sm text-gray-400">
                  새로운 영업시간 제보가 들어오면 여기에 표시됩니다.
                </p>

              </div>
            )}


          <div className="mt-4 space-y-4">

            {reports.map(
              (report) => {

                const groupKey =
                  getGroupKey(
                    report
                  );


                const processing =
                  processingKey ===
                  groupKey;


                const daysLabel =
                  getDaysLabel(
                    report.dayOfWeeks
                  );


                const multiDay =
                  report.dayOfWeeks.length >
                  1;


                return (
                  <article
                    key={
                      groupKey
                    }
                    className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"
                  >

                    <div className="flex items-start justify-between gap-3">

                      <div className="min-w-0">

                        <h3 className="truncate font-bold text-gray-900">
                          {report.restaurantName}
                        </h3>

                        <p className="mt-1 text-xs text-gray-400">
                          {report.roadAddress}
                        </p>

                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">

                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
                          검토 대기
                        </span>

                        {multiDay && (
                          <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-500">
                            {report.dayOfWeeks.length}일 일괄
                          </span>
                        )}

                      </div>

                    </div>


                    <div className="mt-4 rounded-2xl bg-gray-50 p-4">

                      <div className="flex items-center justify-between gap-3">

                        <div>

                          <p className="text-xs font-semibold text-gray-400">
                            적용 요일
                          </p>

                          <p className="mt-1 text-sm font-bold text-gray-800">
                            {daysLabel}
                          </p>

                        </div>

                        {report.isClosed ? (
                          <span className="text-sm font-bold text-red-500">
                            휴무
                          </span>
                        ) : (
                          <span className="text-sm font-bold text-emerald-600">
                            {report.openTime}
                            {" ~ "}
                            {report.closeTime}
                          </span>
                        )}

                      </div>


                      {!report.isClosed &&
                        report.breakStartTime &&
                        report.breakEndTime && (
                          <p className="mt-3 border-t border-gray-100 pt-3 text-xs font-semibold text-amber-600">
                            브레이크타임{" "}
                            {report.breakStartTime}
                            {" ~ "}
                            {report.breakEndTime}
                          </p>
                        )}

                    </div>


                    <div className="mt-4 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">

                      <p>
                        제보자:{" "}
                        <span className="font-semibold text-gray-700">
                          {report.reporterName ||
                            report.reporterEmail}
                        </span>
                      </p>

                      <p className="sm:text-right">
                        {formatSubmittedAt(
                          report.createdAt
                        )}
                      </p>

                    </div>


                    {report.sourceUrl && (
                      <a
                        href={
                          report.sourceUrl
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex text-xs font-bold text-green-600 hover:underline"
                      >
                        네이버 지도에서 확인 →
                      </a>
                    )}


                    <textarea
                      value={
                        reviewNotes[
                          groupKey
                        ] ?? ""
                      }
                      onChange={(event) =>
                        setReviewNotes(
                          (current) => ({
                            ...current,

                            [groupKey]:
                              event.target.value,
                          })
                        )
                      }
                      maxLength={1000}
                      placeholder={
                        multiDay
                          ? "전체 요일에 적용할 검토 메모 (선택)"
                          : "검토 메모 (선택)"
                      }
                      className="mt-4 min-h-20 w-full resize-none rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                    />


                    <div className="mt-3 flex gap-2">

                      <button
                        type="button"
                        disabled={
                          processing
                        }
                        onClick={() =>
                          reviewReport(
                            report,
                            "reject"
                          )
                        }
                        className="flex-1 rounded-xl bg-red-50 py-3 text-sm font-bold text-red-500 disabled:opacity-40"
                      >
                        {multiDay
                          ? "일괄 거절"
                          : "거절"}
                      </button>

                      <button
                        type="button"
                        disabled={
                          processing
                        }
                        onClick={() =>
                          reviewReport(
                            report,
                            "approve"
                          )
                        }
                        className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white disabled:opacity-40"
                      >
                        {processing
                          ? "처리 중..."
                          : multiDay
                            ? `${report.dayOfWeeks.length}일 일괄 승인`
                            : "승인"}
                      </button>

                    </div>

                  </article>
                );
              }
            )}

          </div>

        </section>

      </div>

    </main>
  );
}
