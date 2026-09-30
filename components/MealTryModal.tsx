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
  privateComment: string;
};

type MealTryModalProps = {
  target: MealTryTarget | null;
  onClose: () => void;
  onRecorded?: (restaurantKey: string) => void;
  onRated?: (rating: 1 | -1) => void;
};

function createAttemptToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function MealTryModal({
  target,
  onClose,
  onRecorded,
  onRated,
}: MealTryModalProps) {
  const router = useRouter();

  const [entry, setEntry] = useState<CreatedEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [privateComment, setPrivateComment] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const attemptRef = useRef<{
    signature: string;
    token: string;
  } | null>(null);

  useEffect(() => {
    if (!target) {
      attemptRef.current = null;
      setEntry(null);
      setRating(null);
      setPrivateComment("");
      setMessage("");
      setError("");
      setSaving(false);
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
        token: createAttemptToken(),
      };
    }

    /*
     * 중요: 모달을 여는 것만으로는 DB에 저장하지 않습니다.
     * 사용자가 아래의 "저장하기" 버튼을 눌렀을 때만 기록됩니다.
     */
    setEntry(null);
    setRating(null);
    setPrivateComment("");
    setMessage("");
    setError("");
    setSaving(false);
  }, [target]);

  async function saveRecord() {
    if (!target || saving) return;

    try {
      setSaving(true);
      setError("");
      setMessage("");

      if (!entry) {
        const response = await fetch("/api/meal-history", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientAttemptId: attemptRef.current?.token,
            restaurantKey: target.restaurantKey,
            restaurantName: target.restaurantName,
            roadAddress: target.roadAddress ?? "",
            address: target.address ?? "",
            foodId: target.foodId ?? null,
            menuName: target.menuName ?? null,
            source: target.source,
            rating,
            privateComment,
          }),
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

        setEntry(result.entry);
        setRating(result.entry.rating);
        setPrivateComment(result.entry.privateComment ?? "");
        setMessage(result.message ?? "먹어보기 기록을 저장했어요.");

        onRecorded?.(result.entry.restaurantKey);
        if (result.entry.rating) {
          onRated?.(result.entry.rating);
        }

        window.dispatchEvent(
          new CustomEvent("jummechu:meal-history-updated", {
            detail: {
              restaurantKey: result.entry.restaurantKey,
            },
          })
        );

        return;
      }

      const response = await fetch(`/api/meal-history/${entry.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(rating ? { rating } : {}),
          privateComment,
        }),
      });

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      const result = (await response.json()) as {
        message?: string;
        rating?: 1 | -1 | null;
        privateComment?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "먹어보기 기록을 수정하지 못했습니다.");
      }

      setEntry((current) =>
        current
          ? {
              ...current,
              rating: result.rating ?? current.rating,
              privateComment: result.privateComment ?? privateComment,
            }
          : current
      );
      setMessage(result.message ?? "변경 내용을 저장했어요.");

      if (rating) {
        onRated?.(rating);
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "먹어보기 기록을 저장하지 못했습니다."
      );
    } finally {
      setSaving(false);
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
          <p className="text-sm font-black text-gray-800">
            {entry ? "먹어보기 히스토리에 저장됐어요." : "저장하기 전에는 기록되지 않아요."}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            실제로 먹은 기록을 남기고, 평가는 지금 또는 히스토리에서 나중에 남길 수 있어요.
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-bold text-gray-500">
            식사 후 어땠나요? <span className="font-normal text-gray-300">선택</span>
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setRating((current) => (current === 1 && !entry ? null : 1))}
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
              disabled={saving}
              onClick={() => setRating((current) => (current === -1 && !entry ? null : -1))}
              className={`rounded-xl px-3 py-3 text-sm font-black transition disabled:opacity-50 ${
                rating === -1
                  ? "bg-rose-500 text-white"
                  : "bg-rose-50 text-rose-600 hover:bg-rose-100"
              }`}
            >
              👎 별로였어요
            </button>
          </div>

          {!rating && !entry && (
            <p className="mt-2 text-[10px] leading-4 text-gray-400">
              평가 없이 저장해도 괜찮아요. 히스토리에서 나중에 평가할 수 있어요.
            </p>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="meal-private-comment"
              className="text-xs font-bold text-gray-500"
            >
              🔒 나만 보는 메모
            </label>
            <span className="text-[10px] text-gray-300">
              {privateComment.length}/1000
            </span>
          </div>

          <textarea
            id="meal-private-comment"
            value={privateComment}
            maxLength={1000}
            disabled={saving}
            onChange={(event) => setPrivateComment(event.target.value)}
            placeholder="맛, 분위기, 다음에 먹고 싶은 메뉴 등을 자유롭게 적어보세요."
            className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-700 outline-none transition placeholder:text-gray-300 focus:border-orange-200 focus:bg-white"
          />
          <p className="mt-1 text-[10px] leading-4 text-gray-400">
            이 메모는 현재 본인에게만 보여요. 나중에 리뷰 기능으로 확장할 수 있도록 별도로 저장됩니다.
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-500">
            {error}
          </p>
        )}

        {message && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-500">
            {message}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600 disabled:opacity-50"
          >
            닫기
          </button>

          <button
            type="button"
            onClick={() => void saveRecord()}
            disabled={saving}
            className="rounded-xl bg-orange-500 py-3 text-sm font-black text-white transition hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? "저장 중..." : entry ? "변경 저장" : "저장하기"}
          </button>
        </div>

        {entry && (
          <button
            type="button"
            onClick={() => router.push("/meal-history")}
            className="mt-3 w-full text-center text-xs font-bold text-orange-500 hover:underline"
          >
            먹어본 히스토리에서 확인하기 →
          </button>
        )}
      </div>
    </div>
  );
}
