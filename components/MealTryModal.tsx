"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MealTryTarget = {
  restaurantKey: string;
  restaurantName: string;
  roadAddress?: string | null;
  address?: string | null;
  foodId?: string | null;
  menuName?: string | null;
  source: "recommendation" | "exploration";
};

type CreatedEntry = {
  id: string;
  restaurantKey: string;
  restaurantName: string;
  menuName: string | null;
  foodId: string | null;
  rating: 1 | -1 | null;
};

type MealTryModalProps = {
  target: MealTryTarget | null;
  onClose: () => void;
  onRecorded?: (restaurantKey: string) => void;
  onRated?: (rating: 1 | -1) => void;
};

export default function MealTryModal({
  target,
  onClose,
  onRecorded,
  onRated,
}: MealTryModalProps) {
  const router = useRouter();

  const [entry, setEntry] = useState<CreatedEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const attemptRef = useRef<{
    signature: string;
    token: string;
  } | null>(null);
  const notifiedAttemptTokenRef = useRef<string | null>(null);
  const onRecordedRef = useRef(onRecorded);

  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  useEffect(() => {
    if (!target) {
      attemptRef.current = null;
      notifiedAttemptTokenRef.current = null;
      setEntry(null);
      setRating(null);
      setMessage("");
      setError("");
      return;
    }

    const signature = [
      target.restaurantKey,
      target.menuName ?? "",
      target.foodId ?? "",
      target.source,
    ].join("|");

    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = {
        signature,
        token:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    }

    const controller = new AbortController();

    async function recordTry() {
      try {
        setLoading(true);
        setEntry(null);
        setRating(null);
        setMessage("");
        setError("");

        const response = await fetch("/api/meal-history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientAttemptId: attemptRef.current?.token,
            restaurantKey: target!.restaurantKey,
            restaurantName: target!.restaurantName,
            roadAddress: target!.roadAddress ?? "",
            address: target!.address ?? "",
            foodId: target!.foodId ?? null,
            menuName: target!.menuName ?? null,
            source: target!.source,
          }),
          signal: controller.signal,
        });

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        const result = (await response.json()) as {
          entry?: CreatedEntry;
          message?: string;
        };

        if (!response.ok || !result.entry) {
          throw new Error(result.message ?? "먹어보기 기록을 저장하지 못했습니다.");
        }

        if (controller.signal.aborted) return;

        setEntry(result.entry);
        setRating(result.entry.rating);
        setMessage(result.message ?? "먹어보기 기록에 추가했어요.");

        const currentToken = attemptRef.current?.token ?? null;
        if (
          currentToken &&
          notifiedAttemptTokenRef.current !== currentToken
        ) {
          notifiedAttemptTokenRef.current = currentToken;
          onRecordedRef.current?.(result.entry.restaurantKey);

          window.dispatchEvent(
            new CustomEvent("jummechu:meal-history-updated", {
              detail: {
                restaurantKey: result.entry.restaurantKey,
              },
            })
          );
        }
      } catch (recordError) {
        if (controller.signal.aborted) return;

        setError(
          recordError instanceof Error
            ? recordError.message
            : "먹어보기 기록을 저장하지 못했습니다."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void recordTry();

    return () => controller.abort();
  }, [target, router]);

  async function submitRating(nextRating: 1 | -1) {
    if (!entry || savingRating) return;

    try {
      setSavingRating(true);
      setError("");

      const response = await fetch(`/api/meal-history/${entry.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rating: nextRating }),
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        message?: string;
        rating?: 1 | -1;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "평가를 저장하지 못했습니다.");
      }

      setRating(nextRating);
      setMessage(
        result.message ??
          (nextRating === 1
            ? "좋았어요를 다음 추천에 반영할게요."
            : "별로였어요를 다음 추천에서 조금 덜 반영할게요.")
      );
      onRated?.(nextRating);
    } catch (ratingError) {
      setError(
        ratingError instanceof Error
          ? ratingError.message
          : "평가를 저장하지 못했습니다."
      );
    } finally {
      setSavingRating(false);
    }
  }

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/35 px-5"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-orange-500">🍽️ 먹어보기</p>
            <h3 className="mt-1 text-lg font-black text-gray-900">
              {target.restaurantName}
            </h3>
            {target.menuName && (
              <p className="mt-1 text-sm font-bold text-orange-600">
                추천 메뉴 · {target.menuName}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100"
            aria-label="먹어보기 닫기"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-orange-50 p-4">
          {loading ? (
            <p className="text-sm font-semibold text-orange-600">
              먹어보기 기록에 추가하는 중...
            </p>
          ) : error ? (
            <p className="text-sm leading-6 text-red-500">{error}</p>
          ) : (
            <>
              <p className="text-sm font-black text-gray-800">
                먹어보기 히스토리에 저장했어요.
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                실제로 먹은 뒤 평가하면 다음 메뉴 추천의 취향 가중치가 조금씩 바뀌어요.
              </p>
            </>
          )}
        </div>

        {entry && (
          <div className="mt-4">
            <p className="text-xs font-bold text-gray-500">
              식사 후 어땠나요?
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={savingRating}
                onClick={() => void submitRating(1)}
                className={`rounded-xl px-3 py-3 text-sm font-black transition disabled:opacity-50 ${
                  rating === 1
                    ? "bg-emerald-500 text-white"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                👍 좋았어요
              </button>

              <button
                type="button"
                disabled={savingRating}
                onClick={() => void submitRating(-1)}
                className={`rounded-xl px-3 py-3 text-sm font-black transition disabled:opacity-50 ${
                  rating === -1
                    ? "bg-rose-500 text-white"
                    : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                }`}
              >
                👎 별로였어요
              </button>
            </div>

            {message && (
              <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500">
                {message}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600"
          >
            나중에 평가
          </button>

          <button
            type="button"
            onClick={() => router.push("/meal-history")}
            className="rounded-xl bg-orange-500 py-3 text-sm font-black text-white transition hover:bg-orange-600"
          >
            먹어본 기록 보기
          </button>
        </div>
      </div>
    </div>
  );
}
