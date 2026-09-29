"use client";

import Link from "next/link";
import {
  AppHeader,
  AppShell,
  EmptyState,
  PageIntro,
  SectionHeader,
  jummechuStyles,
} from "@/components/JummechuUI";
import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";


type Friend = {
  friendshipId: string;
  id: string;
  name: string;
  email: string;
  profileImageUrl?: string | null;
};


type FriendRequest = {
  friendshipId: string;
  id: string;
  name: string;
  email: string;
};


type FriendsResponse = {
  friends: Friend[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
};


type RecommendationRequest = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
};


type RecommendationResponse = {
  incomingRequests: RecommendationRequest[];
  outgoingRequests: RecommendationRequest[];
  activeSessions: RecommendationRequest[];
  completedSessions: RecommendationRequest[];
};


export default function FriendsPage() {
  const [data, setData] =
    useState<FriendsResponse>({
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
    });

  const [recommendationData, setRecommendationData] =
    useState<RecommendationResponse>({
      incomingRequests: [],
      outgoingRequests: [],
      activeSessions: [],
      completedSessions: [],
    });

  const [email, setEmail] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");


  const loadData =
    useCallback(
      async () => {
        try {
          const [
            friendsResponse,
            recommendationResponse,
          ] = await Promise.all([
            fetch(
              "/api/friends",
              {
                cache: "no-store",
              }
            ),
            fetch(
              "/api/friend-recommendations",
              {
                cache: "no-store",
              }
            ),
          ]);

          if (
            friendsResponse.status === 401 ||
            recommendationResponse.status === 401
          ) {
            window.location.href =
              "/login";
            return;
          }

          const friendsResult =
            await friendsResponse.json();

          const recommendationResult =
            await recommendationResponse.json();

          if (!friendsResponse.ok) {
            throw new Error(
              friendsResult.message ??
                "친구 목록을 불러오지 못했습니다."
            );
          }

          if (!recommendationResponse.ok) {
            throw new Error(
              recommendationResult.message ??
                "공통메뉴 요청을 불러오지 못했습니다."
            );
          }

          setData(friendsResult);
          setRecommendationData(
            recommendationResult
          );

        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "친구 정보를 불러오지 못했습니다."
          );
        } finally {
          setLoading(false);
        }
      },
      []
    );


  useEffect(() => {
    void loadData();
  }, [loadData]);


  async function requestFriend(
    event: FormEvent
  ) {
    event.preventDefault();
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/friends/request",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                email,
              }),
          }
        );

      const result =
        await response.json();

      setMessage(
        result.message ?? ""
      );

      if (response.ok) {
        setEmail("");
        await loadData();
      }
    } catch {
      setMessage(
        "친구 요청 중 오류가 발생했습니다."
      );
    }
  }


  async function handleFriendRequest(
    friendshipId: string,
    action: "accept" | "reject"
  ) {
    const response =
      await fetch(
        `/api/friends/${friendshipId}/${action}`,
        {
          method: "POST",
        }
      );

    const result =
      await response.json();

    if (!response.ok) {
      setMessage(
        result.message ??
          "처리 중 오류가 발생했습니다."
      );
      return;
    }

    setMessage(
      action === "accept"
        ? "친구 요청을 수락했습니다."
        : "친구 요청을 거절했습니다."
    );

    await loadData();
  }


  async function handleRecommendationRequest(
    sessionId: string,
    action: "accept" | "reject"
  ) {
    try {
      const response =
        await fetch(
          `/api/friend-recommendations/${sessionId}/${action}`,
          {
            method: "POST",
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        setMessage(
          result.message ??
            "처리 중 오류가 발생했습니다."
        );
        return;
      }

      if (
        action === "accept"
      ) {
        window.location.href =
          `/map/friend?sessionId=${sessionId}`;
        return;
      }

      setMessage(
        "공통메뉴 추천 요청을 거절했습니다."
      );

      await loadData();

    } catch {
      setMessage(
        "공통메뉴 추천 요청 처리 중 오류가 발생했습니다."
      );
    }
  }


  return (
    <AppShell>
      <AppHeader
        eyebrow="FRIEND"
        title="친구"
        backHref="/map"
        backLabel="지도로 돌아가기"
        right={
          <Link
            href="/friends/history"
            className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-gray-500 transition hover:bg-gray-100"
            aria-label="같이 먹기 히스토리"
            title="같이 먹기 히스토리"
          >
            🕘
          </Link>
        }
      />

      <div className="pb-24">
        <section className="px-5 pb-2 pt-6">
          <PageIntro
            eyebrow="TASTE TOGETHER"
            title="친구와 메뉴 취향을 맞춰보세요"
            description="친구의 선호 메뉴를 비교하고, 둘 다 만족할 공통메뉴와 주변 식당을 추천받을 수 있어요."
          />
        </section>

        {recommendationData.incomingRequests.length > 0 && (
          <section className="px-5 pt-5">
            <div className="rounded-3xl border border-orange-200 bg-orange-50/70 p-5">
              <SectionHeader
                title="같이 먹기 요청이 왔어요"
                subtitle="수락하면 바로 공통메뉴 추천으로 이동해요."
                right={
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-black text-white">
                    {recommendationData.incomingRequests.length}
                  </span>
                }
              />

              <div className="mt-4 space-y-3">
                {recommendationData.incomingRequests.map((item) => (
                  <div
                    key={item.sessionId}
                    className="rounded-2xl border border-orange-100 bg-white p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-lg">
                        👥
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-900">
                          {item.name}님과 같이 먹기
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          공통 취향 메뉴 추천 요청
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleRecommendationRequest(item.sessionId, "reject")
                        }
                        className={`${jummechuStyles.secondaryButton} py-2.5 text-sm`}
                      >
                        거절
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleRecommendationRequest(item.sessionId, "accept")
                        }
                        className={`${jummechuStyles.primaryButton} py-2.5 text-sm`}
                      >
                        수락하고 보기
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {recommendationData.activeSessions.length > 0 && (
          <section className="px-5 pt-5">
            <SectionHeader
              title="진행 중인 같이 먹기"
              subtitle="최근 추천은 바로 이어서 볼 수 있어요."
              right={
                <Link
                  href="/friends/history"
                  className="text-xs font-black text-orange-500"
                >
                  더보기 ›
                </Link>
              }
            />

            <div className="mt-3">
              {recommendationData.activeSessions.slice(0, 1).map((item) => (
                <Link
                  key={item.sessionId}
                  href={`/map/friend?sessionId=${item.sessionId}`}
                  className="flex items-center justify-between rounded-3xl bg-[#0f172a] px-5 py-5 text-white shadow-sm transition active:scale-[0.99]"
                >
                  <div>
                    <p className="text-[11px] font-black text-orange-300">
                      👥 {item.name}님과
                    </p>
                    <p className="mt-1 text-base font-black">
                      공통메뉴 추천 이어보기
                    </p>
                  </div>
                  <span className="text-2xl text-white/35">›</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="px-5 pt-6">
          <form
            onSubmit={requestFriend}
            className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <SectionHeader
              title="친구 추가"
              subtitle="점메추에 가입한 이메일로 친구를 찾아요."
            />

            <div className="mt-4 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="friend@example.com"
                className={`${jummechuStyles.input} min-w-0 flex-1 px-4 py-3 text-sm`}
                required
              />
              <button
                type="submit"
                className={`${jummechuStyles.primaryButton} px-5 py-3 text-sm`}
              >
                요청
              </button>
            </div>

            {message && (
              <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500">
                {message}
              </p>
            )}
          </form>
        </section>

        {data.incomingRequests.length > 0 && (
          <section className="px-5 pt-6">
            <SectionHeader
              title="받은 친구 요청"
              right={
                <span className={jummechuStyles.orangeBadge}>
                  {data.incomingRequests.length}건
                </span>
              }
            />

            <div className="mt-3 space-y-3">
              {data.incomingRequests.map((item) => (
                <div
                  key={item.friendshipId}
                  className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <p className="font-black text-gray-900">{item.name}</p>
                  <p className="mt-1 text-xs text-gray-400">{item.email}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleFriendRequest(item.friendshipId, "reject")
                      }
                      className={`${jummechuStyles.secondaryButton} py-2.5 text-sm`}
                    >
                      거절
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleFriendRequest(item.friendshipId, "accept")
                      }
                      className={`${jummechuStyles.primaryButton} py-2.5 text-sm`}
                    >
                      수락
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="px-5 pt-7">
          <SectionHeader
            title="내 친구"
            subtitle="친구를 누르면 서로의 취향을 비교할 수 있어요."
            right={
              <span className={jummechuStyles.orangeBadge}>
                {data.friends.length}명
              </span>
            }
          />

          <div className="mt-3">
            {loading ? (
              <div className="rounded-3xl bg-gray-50 p-8 text-center text-sm text-gray-400">
                불러오는 중...
              </div>
            ) : data.friends.length === 0 ? (
              <EmptyState
                emoji="👥"
                title="아직 친구가 없어요"
                description="친구 이메일을 입력해 첫 친구를 추가해보세요."
              />
            ) : (
              <div className="space-y-3">
                {data.friends.map((friend) => (
                  <Link
                    key={friend.id}
                    href={`/friends/${friend.id}`}
                    className="flex items-center justify-between rounded-3xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-orange-100 hover:shadow-md active:scale-[0.99]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-50 text-xl">
                        {friend.profileImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={friend.profileImageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          "👤"
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-gray-900">
                          {friend.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-gray-400">
                          {friend.email}
                        </p>
                        <p className="mt-1.5 text-[11px] font-black text-orange-500">
                          취향 비교 · 같이 먹기
                        </p>
                      </div>
                    </div>
                    <span className="text-2xl text-gray-300">›</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {(data.outgoingRequests.length > 0 ||
          recommendationData.outgoingRequests.length > 0) && (
          <section className="px-5 pt-7">
            <SectionHeader
              title="대기 중인 요청"
              subtitle="상대가 수락하면 자동으로 상태가 바뀌어요."
            />

            <div className="mt-3 space-y-2">
              {data.outgoingRequests.map((item) => (
                <div
                  key={item.friendshipId}
                  className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-bold text-gray-800">{item.name}</p>
                    <p className="mt-1 text-xs text-gray-400">친구 요청</p>
                  </div>
                  <span className="text-[11px] font-bold text-gray-400">수락 대기</span>
                </div>
              ))}

              {recommendationData.outgoingRequests.map((item) => (
                <div
                  key={item.sessionId}
                  className="flex items-center justify-between rounded-2xl bg-orange-50/70 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-bold text-gray-800">{item.name}님</p>
                    <p className="mt-1 text-xs text-orange-500">같이 먹기 요청</p>
                  </div>
                  <span className="text-[11px] font-bold text-orange-400">수락 대기</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
