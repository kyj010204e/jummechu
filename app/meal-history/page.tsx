"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type HistoryItem = {
  id: string;
  restaurantKey: string;
  restaurantName: string;
  roadAddress: string;
  address: string;
  foodId: string | null;
  menuName: string | null;
  source: "recommendation" | "exploration";
  rating: 1 | -1 | null;
  privateComment: string;
  triedAt: string;
  ratedAt: string | null;
};

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildNaverMapLink(item: HistoryItem) {
  const query = [
    item.restaurantName,
    item.roadAddress || item.address,
    item.menuName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

export default function MealHistoryPage() {
  const router = useRouter();

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function loadHistory() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/meal-history", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        const data = (await response.json()) as {
          history?: HistoryItem[];
          message?: string;
        };

        if (!response.ok) {
          throw new Error(data.message ?? "먹어보기 기록을 불러오지 못했습니다.");
        }

        if (!controller.signal.aborted) {
          const nextHistory = Array.isArray(data.history) ? data.history : [];

          setHistory(nextHistory);
          setCommentDrafts(
            Object.fromEntries(
              nextHistory.map((item) => [item.id, item.privateComment ?? ""])
            )
          );
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "먹어보기 기록을 불러오지 못했습니다."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadHistory();

    return () => controller.abort();
  }, [router]);

  const ratedCount = useMemo(
    () => history.filter((item) => item.rating !== null).length,
    [history]
  );

  async function submitRating(id: string, rating: 1 | -1) {
    if (savingId) return;

    try {
      setSavingId(id);
      setMessageById((current) => ({ ...current, [id]: "" }));

      const response = await fetch(`/api/meal-history/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rating }),
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "평가를 저장하지 못했습니다.");
      }

      setHistory((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                rating,
                ratedAt: new Date().toISOString(),
              }
            : item
        )
      );

      setMessageById((current) => ({
        ...current,
        [id]: result.message ?? "평가를 저장했어요.",
      }));
    } catch (ratingError) {
      setMessageById((current) => ({
        ...current,
        [id]:
          ratingError instanceof Error
            ? ratingError.message
            : "평가를 저장하지 못했습니다.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function savePrivateComment(id: string) {
    if (savingId) return;

    try {
      setSavingId(id);
      setMessageById((current) => ({ ...current, [id]: "" }));

      const privateComment = (commentDrafts[id] ?? "").slice(0, 1000);

      const response = await fetch(`/api/meal-history/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ privateComment }),
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        message?: string;
        privateComment?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "개인 메모를 저장하지 못했습니다.");
      }

      const savedComment = result.privateComment ?? privateComment;

      setHistory((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                privateComment: savedComment,
              }
            : item
        )
      );

      setCommentDrafts((current) => ({
        ...current,
        [id]: savedComment,
      }));

      setMessageById((current) => ({
        ...current,
        [id]: result.message ?? "나만 보는 메모를 저장했어요.",
      }));
    } catch (commentError) {
      setMessageById((current) => ({
        ...current,
        [id]:
          commentError instanceof Error
            ? commentError.message
            : "개인 메모를 저장하지 못했습니다.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  async function deleteHistory(id: string) {
    if (savingId) return;

    const confirmed = window.confirm(
      "이 먹어보기 기록을 삭제할까요?\n평가로 반영된 취향도 가능한 범위에서 다시 계산됩니다."
    );

    if (!confirmed) return;

    try {
      setSavingId(id);
      setMessageById((current) => ({ ...current, [id]: "" }));

      const response = await fetch(`/api/meal-history/${id}`, {
        method: "DELETE",
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "먹어보기 기록을 삭제하지 못했습니다.");
      }

      setHistory((current) => current.filter((item) => item.id !== id));
      setCommentDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessageById((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    } catch (deleteError) {
      setMessageById((current) => ({
        ...current,
        [id]:
          deleteError instanceof Error
            ? deleteError.message
            : "먹어보기 기록을 삭제하지 못했습니다.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f7f3] px-4 py-6">
      <section className="mx-auto w-full max-w-[560px] rounded-[30px] bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => router.push("/map")}
              className="text-xs font-bold text-orange-500"
            >
              ← 추천 지도로 돌아가기
            </button>

            <h1 className="mt-3 text-2xl font-black text-gray-900">
              🍽️ 먹어본 기록
            </h1>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              일반 추천과 취향 탐험에서 저장한 식사 기록이에요.
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              🔒 개인 메모는 현재 본인 계정에서만 확인할 수 있어요.
            </p>
          </div>

          <div className="rounded-2xl bg-orange-50 px-3 py-2 text-right">
            <p className="text-[10px] font-bold text-orange-400">전체</p>
            <p className="text-lg font-black text-orange-600">{history.length}</p>
          </div>
        </div>

        {!loading && history.length > 0 && (
          <div className="mt-4 flex gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 font-semibold text-gray-500">
              평가 완료 {ratedCount}
            </span>
            <span className="rounded-full bg-amber-50 px-3 py-1.5 font-semibold text-amber-600">
              나중에 평가 {history.length - ratedCount}
            </span>
          </div>
        )}

        {loading && (
          <div className="py-16 text-center text-sm text-gray-400">
            먹어본 기록을 불러오는 중...
          </div>
        )}

        {!loading && error && (
          <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-500">
            {error}
          </div>
        )}

        {!loading && !error && history.length === 0 && (
          <div className="mt-6 rounded-3xl bg-gray-50 px-5 py-12 text-center">
            <p className="text-3xl">🍚</p>
            <p className="mt-3 text-sm font-black text-gray-700">
              아직 먹어본 기록이 없어요.
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              추천 카드의 먹어보기 버튼이나 카드 더블클릭 후 저장하기를 눌러주세요.
            </p>
            <button
              type="button"
              onClick={() => router.push("/map")}
              className="mt-5 rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-white"
            >
              추천 보러가기
            </button>
          </div>
        )}

        {!loading && !error && history.length > 0 && (
          <div className="mt-6 space-y-3">
            {history.map((item) => {
              const saving = savingId === item.id;
              const message = messageById[item.id];
              const commentDraft = commentDrafts[item.id] ?? "";
              const commentChanged = commentDraft !== (item.privateComment ?? "");

              return (
                <article
                  key={item.id}
                  className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                            item.source === "exploration"
                              ? "bg-violet-100 text-violet-700"
                              : "bg-orange-100 text-orange-600"
                          }`}
                        >
                          {item.source === "exploration"
                            ? "✨ 취향 탐험"
                            : "🍽️ 일반 추천"}
                        </span>

                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold text-gray-500">
                          {formatDate(item.triedAt)}
                        </span>
                      </div>

                      <h2 className="mt-2 truncate text-base font-black text-gray-900">
                        {item.restaurantName}
                      </h2>

                      {item.menuName && (
                        <p className="mt-1 text-sm font-bold text-orange-600">
                          추천 메뉴 · {item.menuName}
                        </p>
                      )}

                      <p className="mt-2 line-clamp-1 text-xs text-gray-400">
                        {item.roadAddress || item.address || "주소 정보 없음"}
                      </p>
                    </div>

                    <div
                      className={`shrink-0 rounded-2xl px-3 py-2 text-xs font-black ${
                        item.rating === 1
                          ? "bg-emerald-50 text-emerald-600"
                          : item.rating === -1
                            ? "bg-rose-50 text-rose-600"
                            : "bg-amber-50 text-amber-600"
                      }`}
                    >
                      {item.rating === 1
                        ? "👍 좋았어요"
                        : item.rating === -1
                          ? "👎 별로였어요"
                          : "평가 대기"}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void submitRating(item.id, 1)}
                      className={`rounded-xl py-2.5 text-xs font-black transition disabled:opacity-50 ${
                        item.rating === 1
                          ? "bg-emerald-500 text-white"
                          : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      }`}
                    >
                      👍 좋았어요
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void submitRating(item.id, -1)}
                      className={`rounded-xl py-2.5 text-xs font-black transition disabled:opacity-50 ${
                        item.rating === -1
                          ? "bg-rose-500 text-white"
                          : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                      }`}
                    >
                      👎 별로였어요
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black text-gray-600">
                        🔒 나만 보는 메모
                      </p>
                      <span className="text-[10px] text-gray-300">
                        {commentDraft.length}/1000
                      </span>
                    </div>

                    <textarea
                      value={commentDraft}
                      maxLength={1000}
                      disabled={saving}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      placeholder="맛, 분위기, 재방문하고 싶은 메뉴 등을 적어보세요."
                      className="mt-2 min-h-20 w-full resize-none rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs leading-5 text-gray-700 outline-none placeholder:text-gray-300 focus:border-orange-200"
                    />

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[10px] text-gray-400">
                        다른 사용자에게 공개되지 않아요.
                      </p>
                      <button
                        type="button"
                        disabled={saving || !commentChanged}
                        onClick={() => void savePrivateComment(item.id)}
                        className="rounded-lg bg-white px-3 py-1.5 text-[11px] font-black text-orange-500 shadow-sm disabled:cursor-not-allowed disabled:text-gray-300 disabled:shadow-none"
                      >
                        메모 저장
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <a
                      href={buildNaverMapLink(item)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-green-600 hover:underline"
                    >
                      네이버 지도에서 보기 →
                    </a>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void deleteHistory(item.id)}
                      className="text-xs font-bold text-rose-400 transition hover:text-rose-600 disabled:opacity-40"
                    >
                      기록 삭제
                    </button>
                  </div>

                  {item.ratedAt && (
                    <p className="mt-2 text-right text-[10px] text-gray-300">
                      평가 {formatDate(item.ratedAt)}
                    </p>
                  )}

                  {message && (
                    <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500">
                      {message}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
