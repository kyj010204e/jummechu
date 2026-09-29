"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";


type ReportStatus =
  | "pending"
  | "approved"
  | "rejected";


type PriceReport = {
  id: string;

  userId: string;
  userEmail:
    string | null;
  userName:
    string | null;

  restaurantMenuPriceId:
    string | null;

  restaurantName: string;
  restaurantAddress:
    string | null;

  menuName: string;

  reportedPriceKrw: number;
  previousPriceKrw:
    number | null;

  note:
    string | null;

  status: ReportStatus;

  confidence: number;

  reviewedAt:
    string | null;

  reviewNote:
    string | null;

  createdAt: string;
  updatedAt: string;

  evidenceCount: number;
};


type ReportsResponse = {
  message?: string;

  status?: ReportStatus;

  reports?: PriceReport[];
};


function formatPrice(
  value:
    number |
    null
) {
  if (
    value ===
    null
  ) {
    return "-";
  }

  return `${value.toLocaleString(
    "ko-KR"
  )}원`;
}


function formatDate(
  value: string
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    "ko-KR"
  );
}


export default function AdminPriceReportsPage() {
  const [
    status,
    setStatus,
  ] =
    useState<ReportStatus>(
      "pending"
    );

  const [
    reports,
    setReports,
  ] =
    useState<
      PriceReport[]
    >([]);

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
    workingId,
    setWorkingId,
  ] =
    useState<
      string |
      null
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


  const loadReports =
    useCallback(
      async () => {
        try {
          setLoading(
            true
          );

          setError(
            ""
          );


          const response =
            await fetch(
              `/api/admin/price-reports?status=${status}`,
              {
                cache:
                  "no-store",
              }
            );


          const data =
            (await response.json()) as
              ReportsResponse;


          if (
            !response.ok
          ) {
            throw new Error(
              data.message ??
                "가격 제보를 불러오지 못했습니다."
            );
          }


          setReports(
            data.reports ??
              []
          );


        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "가격 제보를 불러오지 못했습니다."
          );

        } finally {
          setLoading(
            false
          );
        }
      },
      [
        status,
      ]
    );


  useEffect(() => {
    void loadReports();
  }, [
    loadReports,
  ]);


  async function reviewReport(
    reportId: string,
    action:
      | "approve"
      | "reject"
  ) {
    try {
      setWorkingId(
        reportId
      );

      setError(
        ""
      );


      const response =
        await fetch(
          "/api/admin/price-reports",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                reportId,

                action,

                reviewNote:
                  reviewNotes[
                    reportId
                  ] ??
                  "",
              }),
          }
        );


      const data =
        (await response.json()) as {
          message?: string;
        };


      if (
        !response.ok
      ) {
        throw new Error(
          data.message ??
            "가격 제보 처리에 실패했습니다."
        );
      }


      setReports(
        (current) =>
          current.filter(
            (report) =>
              report.id !==
              reportId
          )
      );


    } catch (
      reviewError
    ) {
      setError(
        reviewError instanceof
          Error
          ? reviewError.message
          : "가격 제보 처리에 실패했습니다."
      );

    } finally {
      setWorkingId(
        null
      );
    }
  }


  return (
    <main className="min-h-screen bg-[#fffaf5] px-4 py-8">

      <div className="mx-auto w-full max-w-3xl">

        <div className="flex flex-wrap items-start justify-between gap-4">

          <div>

            <p className="text-xs font-bold text-orange-500">
              JUMMECHU ADMIN
            </p>

            <h1 className="mt-1 text-2xl font-black text-gray-900">
              가격 제보 관리
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              승인된 가격은 음식점 실제 가격으로 저장되고,
              DB 트리거가 지역 평균가격을 자동으로 다시 계산합니다.
            </p>

          </div>


          <div className="flex gap-2">

            <Link
              href="/admin"
              className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-gray-600 shadow-sm"
            >
              관리자
            </Link>

            <Link
              href="/map"
              className="rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white shadow-sm"
            >
              지도
            </Link>

          </div>

        </div>


        <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-orange-50 p-1.5">

          {(
            [
              [
                "pending",
                "대기",
              ],

              [
                "approved",
                "승인",
              ],

              [
                "rejected",
                "반려",
              ],
            ] as const
          ).map(
            (
              [
                value,
                label,
              ]
            ) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setStatus(
                    value
                  )
                }
                className={`rounded-xl py-2.5 text-sm font-bold transition ${
                  status ===
                  value
                    ? "bg-white text-orange-500 shadow-sm"
                    : "text-gray-500"
                }`}
              >
                {label}
              </button>
            )
          )}

        </div>


        {error && (
          <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-500">
            {error}
          </div>
        )}


        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">
            가격 제보를 불러오는 중...
          </div>

        ) : reports.length ===
          0 ? (
          <div className="mt-6 rounded-3xl border border-orange-100 bg-white p-8 text-center shadow-sm">

            <p className="text-3xl">
              💰
            </p>

            <p className="mt-3 font-bold text-gray-700">
              {
                status ===
                "pending"
                  ? "검토할 가격 제보가 없어요."
                  : "해당 내역이 없어요."
              }
            </p>

          </div>

        ) : (
          <div className="mt-6 space-y-4">

            {reports.map(
              (
                report
              ) => (
                <article
                  key={
                    report.id
                  }
                  className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm"
                >

                  <div className="flex items-start justify-between gap-4">

                    <div className="min-w-0">

                      <p className="truncate text-lg font-black text-gray-900">
                        {
                          report.restaurantName
                        }
                      </p>

                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        {
                          report.restaurantAddress ||
                          "주소 정보 없음"
                        }
                      </p>

                    </div>


                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        report.status ===
                        "pending"
                          ? "bg-amber-50 text-amber-600"
                          : report.status ===
                              "approved"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-red-50 text-red-500"
                      }`}
                    >
                      {
                        report.status ===
                        "pending"
                          ? "검토 대기"
                          : report.status ===
                              "approved"
                            ? "승인됨"
                            : "반려됨"
                      }
                    </span>

                  </div>


                  <div className="mt-4 rounded-2xl bg-orange-50/70 p-4">

                    <p className="text-xs font-bold text-orange-500">
                      🍽️ {
                        report.menuName
                      }
                    </p>

                    <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">

                      <p className="text-2xl font-black text-gray-900">
                        {
                          formatPrice(
                            report.reportedPriceKrw
                          )
                        }
                      </p>

                      {report.previousPriceKrw !==
                        null && (
                        <p className="pb-1 text-xs text-gray-400">
                          기존{" "}
                          {
                            formatPrice(
                              report.previousPriceKrw
                            )
                          }
                        </p>
                      )}

                    </div>

                  </div>


                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">

                    <div className="rounded-2xl bg-gray-50 p-3">

                      <p className="font-semibold text-gray-400">
                        제보자
                      </p>

                      <p className="mt-1 break-all font-bold text-gray-700">
                        {
                          report.userName ||
                          report.userEmail ||
                          `사용자 ${report.userId}`
                        }
                      </p>

                    </div>


                    <div className="rounded-2xl bg-gray-50 p-3">

                      <p className="font-semibold text-gray-400">
                        제보 시각
                      </p>

                      <p className="mt-1 font-bold text-gray-700">
                        {
                          formatDate(
                            report.createdAt
                          )
                        }
                      </p>

                    </div>

                  </div>


                  {report.note && (
                    <div className="mt-3 rounded-2xl bg-gray-50 px-4 py-3">

                      <p className="text-[11px] font-bold text-gray-400">
                        제보 메모
                      </p>

                      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-600">
                        {
                          report.note
                        }
                      </p>

                    </div>
                  )}


                  {report.evidenceCount >
                    0 && (
                    <p className="mt-3 text-xs font-semibold text-blue-500">
                      📎 증빙 {
                        report.evidenceCount
                      }개
                    </p>
                  )}


                  {report.status ===
                    "pending" && (
                    <>

                      <textarea
                        value={
                          reviewNotes[
                            report.id
                          ] ??
                          ""
                        }
                        onChange={(
                          event
                        ) =>
                          setReviewNotes(
                            (
                              current
                            ) => ({
                              ...current,

                              [report.id]:
                                event.target.value,
                            })
                          )
                        }
                        maxLength={
                          1000
                        }
                        rows={2}
                        placeholder="관리자 메모 (선택)"
                        className="mt-4 w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-300 focus:border-orange-400"
                      />


                      <div className="mt-3 grid grid-cols-2 gap-2">

                        <button
                          type="button"
                          disabled={
                            workingId ===
                            report.id
                          }
                          onClick={() =>
                            reviewReport(
                              report.id,
                              "reject"
                            )
                          }
                          className="rounded-xl bg-red-50 py-3 text-sm font-bold text-red-500 transition hover:bg-red-100 disabled:opacity-40"
                        >
                          반려
                        </button>


                        <button
                          type="button"
                          disabled={
                            workingId ===
                            report.id
                          }
                          onClick={() =>
                            reviewReport(
                              report.id,
                              "approve"
                            )
                          }
                          className="rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-40"
                        >
                          {
                            workingId ===
                            report.id
                              ? "처리 중..."
                              : "승인"
                          }
                        </button>

                      </div>

                    </>
                  )}


                  {report.status !==
                    "pending" &&
                    report.reviewNote && (
                    <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-3">

                      <p className="text-[11px] font-bold text-gray-400">
                        관리자 메모
                      </p>

                      <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-600">
                        {
                          report.reviewNote
                        }
                      </p>

                    </div>
                  )}

                </article>
              )
            )}

          </div>
        )}

      </div>

    </main>
  );
}
