"use client";

import Link from "next/link";
import {
  use,
  useEffect,
  useMemo,
  useState,
} from "react";


type Preference = {
  id: string;
  name: string;
  weight: number;
  favorite: boolean;
};


type CommonPreference = {
  id: string;
  name: string;
  myWeight: number;
  friendWeight: number;
  bothFavorite: boolean;
};


type FriendDetailResponse = {
  friend: {
    id: string;
    name: string;
    email: string;
    profileImageUrl: string | null;
  };
  myPreferences: Preference[];
  friendPreferences: Preference[];
  commonPreferences: CommonPreference[];
  recommendationState?: {
    hasCompletedRecommendation: boolean;
    activeSessionId: string | null;
    pendingSessionId: string | null;
    pendingDirection: "incoming" | "outgoing" | null;
  };
  message?: string;
};


export default function FriendDetailPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const {
    id: friendId,
  } = use(params);

  const [data, setData] =
    useState<FriendDetailResponse | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [requesting, setRequesting] =
    useState(false);

  const [message, setMessage] =
    useState("");


  useEffect(() => {
    const controller =
      new AbortController();

    async function load() {
      try {
        const response =
          await fetch(
            `/api/friends/${friendId}`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            }
          );

        if (
          response.status === 401
        ) {
          window.location.href =
            "/login";
          return;
        }

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ??
              "친구 정보를 불러오지 못했습니다."
          );
        }

        if (
          !controller.signal.aborted
        ) {
          setData(result);
        }
      } catch (error) {
        if (
          !controller.signal.aborted
        ) {
          setMessage(
            error instanceof Error
              ? error.message
              : "친구 정보를 불러오지 못했습니다."
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

    void load();

    return () =>
      controller.abort();
  }, [friendId]);


  const commonIds =
    useMemo(
      () =>
        new Set(
          data?.commonPreferences.map(
            (item) => item.id
          ) ?? []
        ),
      [data]
    );


  async function requestCommonRecommendation() {
    if (requesting) {
      return;
    }

    const state =
      data?.recommendationState;

    if (state?.activeSessionId) {
      window.location.href =
        `/map/friend?sessionId=${state.activeSessionId}`;
      return;
    }

    if (
      state?.pendingSessionId &&
      state.pendingDirection ===
        "incoming"
    ) {
      window.location.href =
        "/friends";
      return;
    }

    if (
      state?.pendingSessionId &&
      state.pendingDirection ===
        "outgoing"
    ) {
      setMessage(
        "친구의 수락을 기다리고 있어요."
      );
      return;
    }

    try {
      setRequesting(true);
      setMessage("");

      const response =
        await fetch(
          "/api/friend-recommendations/request",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                friendId,
              }),
          }
        );

      const result =
        await response.json();

      if (
        response.status === 401
      ) {
        window.location.href =
          "/login";
        return;
      }

      /*
       * 이미 완료 이력이 있는 친구는 서버가 새 ACCEPTED 세션을
       * 즉시 만들기 때문에 별도 수락 화면 없이 추천 지도로 이동합니다.
       */
      if (
        response.ok &&
        result.autoAccepted &&
        result.sessionId
      ) {
        window.location.href =
          `/map/friend?sessionId=${result.sessionId}`;
        return;
      }

      /*
       * 중복 클릭 등으로 이미 ACCEPTED 세션이 있으면
       * 기존 진행 중 세션으로 바로 이동합니다.
       */
      if (
        response.status === 409 &&
        result.active &&
        result.sessionId
      ) {
        window.location.href =
          `/map/friend?sessionId=${result.sessionId}`;
        return;
      }

      setMessage(
        result.message ?? ""
      );

      if (
        response.ok &&
        result.sessionId
      ) {
        setData(
          (current) =>
            current
              ? {
                  ...current,
                  recommendationState: {
                    hasCompletedRecommendation:
                      current.recommendationState
                        ?.hasCompletedRecommendation ??
                      false,
                    activeSessionId: null,
                    pendingSessionId:
                      String(
                        result.sessionId
                      ),
                    pendingDirection:
                      "outgoing",
                  },
                }
              : current
        );
      }
    } catch {
      setMessage(
        "공통메뉴 추천 요청 중 오류가 발생했습니다."
      );
    } finally {
      setRequesting(false);
    }
  }


  const recommendationState =
    data?.recommendationState;

  const recommendationDescription =
    recommendationState?.activeSessionId
      ? "이미 진행 중인 같이 먹기가 있어요. 바로 이어서 볼 수 있어요."
      : recommendationState?.pendingDirection ===
          "incoming"
        ? "친구가 같이 먹기 요청을 보냈어요. 친구 화면에서 확인해주세요."
        : recommendationState?.pendingDirection ===
            "outgoing"
          ? "요청을 보냈어요. 친구의 수락을 기다리고 있어요."
          : recommendationState
              ?.hasCompletedRecommendation
            ? "이미 함께 추천받은 친구라 이번에는 재승인 없이 바로 새 추천을 시작해요."
            : "처음 같이 먹을 때는 상대방이 수락하면 두 사람의 취향을 함께 반영해 추천해요.";

  const recommendationButtonLabel =
    requesting
      ? recommendationState
          ?.hasCompletedRecommendation
        ? "추천 준비 중..."
        : "요청 보내는 중..."
      : recommendationState?.activeSessionId
        ? "🍚 진행 중인 같이 먹기 열기"
        : recommendationState?.pendingDirection ===
            "incoming"
          ? "🍚 받은 요청 확인하기"
          : recommendationState?.pendingDirection ===
              "outgoing"
            ? "⏳ 수락 대기 중"
            : recommendationState
                ?.hasCompletedRecommendation
              ? "🍚 다시 같이 먹기"
              : "🍚 공통메뉴 추천 요청하기";


  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 px-5 py-8">
        <div className="mx-auto max-w-md">
          <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-400 shadow-sm">
            친구의 취향을 불러오는 중...
          </div>
        </div>
      </main>
    );
  }


  if (!data) {
    return (
      <main className="min-h-screen bg-gray-50 px-5 py-8">
        <div className="mx-auto max-w-md">
          <Link
            href="/friends"
            className="text-sm font-semibold text-gray-600"
          >
            ← 친구 목록
          </Link>

          <div className="mt-6 rounded-3xl bg-white p-6 text-sm text-red-500 shadow-sm">
            {message ||
              "친구 정보를 불러오지 못했습니다."}
          </div>
        </div>
      </main>
    );
  }


  return (
    <main className="min-h-screen bg-gray-50 px-5 py-8">
      <div className="mx-auto max-w-md pb-24">

        <Link
          href="/friends"
          className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-gray-600 transition hover:bg-white hover:text-orange-500"
        >
          <span className="text-lg">←</span>
          <span>친구 목록</span>
        </Link>


        <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-2xl">
              {data.friend.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.friend.profileImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                "👤"
              )}
            </div>

            <div className="min-w-0">
              <p className="text-xs font-extrabold text-orange-500">
                TASTE MATCH
              </p>

              <h1 className="mt-1 truncate text-2xl font-extrabold text-gray-900">
                {data.friend.name}
              </h1>

              <p className="mt-1 truncate text-xs text-gray-400">
                {data.friend.email}
              </p>
            </div>
          </div>
        </section>


        <section className="mt-5 rounded-3xl border border-orange-100 bg-orange-50/70 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-gray-900">
                🤝 공통으로 좋아하는 메뉴
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-500">
                둘 다 직접 선택한 메뉴예요. 최애가 겹치면 ♥로 표시해요.
              </p>
            </div>

            <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-orange-500 shadow-sm">
              {data.commonPreferences.length}개
            </span>
          </div>

          {data.commonPreferences.length === 0 ? (
            <div className="mt-4 rounded-2xl bg-white/80 p-4 text-sm text-gray-500">
              직접 겹치는 메뉴는 없지만, 임베딩으로 두 사람 모두에게 가까운 메뉴를 추천할 수 있어요.
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.commonPreferences.map(
                (item) => (
                  <span
                    key={item.id}
                    className="rounded-full bg-white px-3 py-2 text-sm font-bold text-orange-600 shadow-sm"
                  >
                    {item.bothFavorite
                      ? "♥ "
                      : ""}
                    {item.name}
                  </span>
                )
              )}
            </div>
          )}
        </section>


        <div className="mt-5 grid grid-cols-2 gap-3">
          <PreferencePanel
            title="내 취향"
            emoji="😋"
            items={data.myPreferences}
            commonIds={commonIds}
          />

          <PreferencePanel
            title={`${data.friend.name} 취향`}
            emoji="🙂"
            items={data.friendPreferences}
            commonIds={commonIds}
          />
        </div>


        <section className="mt-5 rounded-3xl bg-gray-900 p-5 text-white shadow-sm">
          <p className="text-xs font-extrabold text-orange-300">
            같이 먹기
          </p>

          <h2 className="mt-2 text-xl font-extrabold">
            둘 다 만족할 메뉴를 찾아볼까요?
          </h2>

          <p className="mt-2 text-xs leading-5 text-white/60">
            {recommendationDescription}
          </p>

          <button
            type="button"
            disabled={
              requesting ||
              recommendationState
                ?.pendingDirection ===
                "outgoing"
            }
            onClick={
              requestCommonRecommendation
            }
            className="mt-5 w-full rounded-2xl bg-orange-500 py-4 text-sm font-extrabold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recommendationButtonLabel}
          </button>

          {message && (
            <p className="mt-3 text-center text-xs text-white/70">
              {message}
            </p>
          )}
        </section>

      </div>
    </main>
  );
}


function PreferencePanel({
  title,
  emoji,
  items,
  commonIds,
}: {
  title: string;
  emoji: string;
  items: Preference[];
  commonIds: Set<string>;
}) {
  return (
    <section className="min-w-0 rounded-3xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span>{emoji}</span>
        <h2 className="truncate text-sm font-extrabold text-gray-900">
          {title}
        </h2>
      </div>

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs leading-5 text-gray-400">
            등록된 상세 선호 메뉴가 없습니다.
          </p>
        ) : (
          items.map(
            (item) => (
              <div
                key={item.id}
                className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                  commonIds.has(item.id)
                    ? "bg-orange-50 text-orange-600"
                    : "bg-gray-50 text-gray-600"
                }`}
              >
                {item.favorite
                  ? "♥ "
                  : ""}
                {item.name}
              </div>
            )
          )
        )}
      </div>
    </section>
  );
}
