"use client";

import {
  AppHeader,
  AppShell,
  PageIntro,
  SectionHeader,
  jummechuStyles,
} from "@/components/JummechuUI";
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

      setMessage(
        result.message ?? ""
      );

      if (
        response.status === 401
      ) {
        window.location.href =
          "/login";
      }
    } catch {
      setMessage(
        "공통메뉴 추천 요청 중 오류가 발생했습니다."
      );
    } finally {
      setRequesting(false);
    }
  }


  if (loading) {
    return (
      <AppShell>
        <AppHeader
          eyebrow="TASTE MATCH"
          title="취향 비교"
          backHref="/friends"
          backLabel="친구 목록"
        />
        <div className="flex min-h-[70vh] items-center justify-center px-5">
          <div className="text-center">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />
            <p className="mt-4 text-sm text-gray-500">
              친구의 취향을 불러오는 중...
            </p>
          </div>
        </div>
      </AppShell>
    );
  }


  if (!data) {
    return (
      <AppShell>
        <AppHeader
          eyebrow="TASTE MATCH"
          title="취향 비교"
          backHref="/friends"
          backLabel="친구 목록"
        />
        <div className="px-5 py-6">
          <div className="rounded-3xl bg-red-50 p-5 text-sm leading-6 text-red-500">
            {message || "친구 정보를 불러오지 못했습니다."}
          </div>
        </div>
      </AppShell>
    );
  }


  return (
    <AppShell>
      <AppHeader
        eyebrow="TASTE MATCH"
        title={data.friend.name}
        backHref="/friends"
        backLabel="친구 목록"
      />

      <div className="pb-24">
        <section className="px-5 pb-2 pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-50 text-2xl ring-4 ring-orange-50">
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
              <PageIntro
                eyebrow="FRIEND PROFILE"
                title={data.friend.name}
                description={data.friend.email}
              />
            </div>
          </div>
        </section>

        <section className="px-5 pt-5">
          <div className="rounded-3xl border border-orange-100 bg-orange-50/70 p-5">
            <SectionHeader
              title="공통으로 좋아하는 메뉴"
              subtitle="둘 다 직접 선택한 메뉴예요. 최애가 겹치면 ♥로 표시해요."
              right={
                <span className={jummechuStyles.orangeBadge}>
                  {data.commonPreferences.length}개
                </span>
              }
            />

            {data.commonPreferences.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-white/80 px-4 py-4 text-xs leading-5 text-gray-500">
                직접 겹치는 메뉴는 없지만, 임베딩으로 두 사람 모두에게 가까운 메뉴를 찾아낼 수 있어요.
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.commonPreferences.map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full border border-orange-100 bg-white px-3 py-2 text-xs font-black text-orange-600 shadow-sm"
                  >
                    {item.bothFavorite ? "♥ " : ""}
                    {item.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="px-5 pt-6">
          <SectionHeader
            title="서로의 취향"
            subtitle="주황색 메뉴는 두 사람에게 공통으로 등록된 메뉴예요."
          />

          <div className="mt-3 grid grid-cols-2 gap-3">
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
        </section>

        <section className="px-5 pt-6">
          <div className="rounded-3xl bg-[#0f172a] p-5 text-white shadow-sm">
            <p className="text-[11px] font-black tracking-[0.08em] text-orange-300">
              FRIEND MATCH
            </p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.02em]">
              둘 다 만족할 메뉴를 찾아볼까요?
            </h2>
            <p className="mt-2 text-xs leading-5 text-white/55">
              상대방이 수락하면 두 사람의 취향 임베딩을 함께 반영해서 공통메뉴와 주변 식당을 추천해요.
            </p>

            <button
              type="button"
              disabled={requesting}
              onClick={requestCommonRecommendation}
              className={`${jummechuStyles.primaryButton} mt-5 w-full py-4 text-sm`}
            >
              {requesting ? "요청 보내는 중..." : "🍚 공통메뉴 추천 요청하기"}
            </button>

            {message && (
              <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-center text-xs leading-5 text-white/70">
                {message}
              </p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
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
    <section className="min-w-0 rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
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
