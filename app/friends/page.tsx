"use client";

import Link from "next/link";
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

  const [processingFriendshipId, setProcessingFriendshipId] =
    useState<string | null>(null);


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
    if (processingFriendshipId) {
      return;
    }

    try {
      setProcessingFriendshipId(friendshipId);
      setMessage("");

      const response =
        await fetch(
          `/api/friends/${friendshipId}/${action}`,
          {
            method: "POST",
            cache: "no-store",
          }
        );

      const contentType =
        response.headers.get("content-type") ?? "";

      const result =
        contentType.includes("application/json")
          ? await response.json()
          : {
              message:
                `친구 요청 처리 API 응답이 올바르지 않습니다. (HTTP ${response.status})`,
            };

      if (
        response.status === 401
      ) {
        window.location.href =
          "/login";
        return;
      }

      if (!response.ok) {
        setMessage(
          result.message ??
            "친구 요청 처리 중 오류가 발생했습니다."
        );
        return;
      }

      setMessage(
        action === "accept"
          ? "친구 요청을 수락했습니다."
          : "친구 요청을 거절했습니다."
      );

      await loadData();
    } catch (error) {
      console.error(
        "Friend request action error:",
        error
      );

      setMessage(
        "친구 요청 처리 API에 연결하지 못했습니다."
      );
    } finally {
      setProcessingFriendshipId(null);
    }
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
    <main className="min-h-screen bg-gray-50 px-5 py-8">
      <div className="mx-auto max-w-md pb-24">

        <div className="mb-5">
          <Link
            href="/map"
            className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-gray-600 transition hover:bg-white hover:text-orange-500"
          >
            <span className="text-lg">←</span>
            <span>지도로 돌아가기</span>
          </Link>
        </div>


        <div className="mb-7">
          <p className="text-sm font-bold text-orange-500">
            FRIEND
          </p>

          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            친구
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            친구와 취향을 비교하고 함께 먹을 메뉴를 추천받아보세요.
          </p>
        </div>


        {/* 같이 먹기 요청 */}
        {recommendationData.incomingRequests.length > 0 && (
          <section className="mb-6 rounded-3xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-orange-500">
                  🍚 같이 먹기 요청
                </p>

                <h2 className="mt-1 font-extrabold text-gray-900">
                  공통메뉴 추천 요청이 왔어요
                </h2>
              </div>

              <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-extrabold text-white">
                {recommendationData.incomingRequests.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {recommendationData.incomingRequests.map(
                (item) => (
                  <div
                    key={item.sessionId}
                    className="rounded-2xl bg-white p-4 shadow-sm"
                  >
                    <p className="font-bold text-gray-900">
                      {item.name}님
                    </p>

                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      같이 먹을 메뉴를 추천받고 싶어해요.
                    </p>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleRecommendationRequest(
                            item.sessionId,
                            "reject"
                          )
                        }
                        className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-600"
                      >
                        거절
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleRecommendationRequest(
                            item.sessionId,
                            "accept"
                          )
                        }
                        className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-extrabold text-white"
                      >
                        수락하고 추천 보기
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
        )}


        {/* 최근 수락된 같이 먹기 */}
        {recommendationData.activeSessions.length > 0 && (
          <section className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">
                진행 중인 같이 먹기
              </h2>

              <Link
                href="/friends/history"
                className="text-xs font-bold text-orange-500 transition hover:text-orange-600"
              >
                더보기 ›
              </Link>
            </div>

            <div className="space-y-2">
              {recommendationData.activeSessions
                .slice(0, 1)
                .map((item) => (
                  <Link
                    key={item.sessionId}
                    href={`/map/friend?sessionId=${item.sessionId}`}
                    className="flex items-center justify-between rounded-2xl bg-gray-900 px-4 py-4 text-white shadow-sm"
                  >
                    <div>
                      <p className="text-xs font-bold text-orange-300">
                        👥 {item.name}님과
                      </p>

                      <p className="mt-1 text-sm font-extrabold">
                        공통메뉴 추천 보기
                      </p>
                    </div>

                    <span className="text-xl text-white/50">
                      ›
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        )}


        {/* 친구 추가 */}
        <form
          onSubmit={requestFriend}
          className="rounded-3xl bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold text-gray-900">
            친구 추가
          </h2>

          <p className="mt-1 text-xs text-gray-400">
            가입한 이메일로 친구를 찾습니다.
          </p>

          <div className="mt-4 flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              placeholder="friend@example.com"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-orange-400"
              required
            />

            <button
              type="submit"
              className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
            >
              요청
            </button>
          </div>

          {message && (
            <p className="mt-3 text-xs text-gray-500">
              {message}
            </p>
          )}
        </form>


        {/* 받은 친구 요청 */}
        {data.incomingRequests.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 font-bold">
              받은 친구 요청
            </h2>

            <div className="space-y-3">
              {data.incomingRequests.map(
                (item) => (
                  <div
                    key={item.friendshipId}
                    className="rounded-2xl bg-white p-4 shadow-sm"
                  >
                    <div>
                      <p className="font-semibold">
                        {item.name}
                      </p>

                      <p className="text-xs text-gray-400">
                        {item.email}
                      </p>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={
                          processingFriendshipId !== null
                        }
                        onClick={() =>
                          handleFriendRequest(
                            item.friendshipId,
                            "reject"
                          )
                        }
                        className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingFriendshipId === item.friendshipId
                          ? "처리 중..."
                          : "거절"}
                      </button>

                      <button
                        type="button"
                        disabled={
                          processingFriendshipId !== null
                        }
                        onClick={() =>
                          handleFriendRequest(
                            item.friendshipId,
                            "accept"
                          )
                        }
                        className="flex-1 rounded-xl bg-orange-500 py-2.5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingFriendshipId === item.friendshipId
                          ? "처리 중..."
                          : "수락"}
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
        )}


        {/* 친구 목록 */}
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">
              내 친구
            </h2>

            <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-500">
              {data.friends.length}명
            </span>
          </div>

          {loading ? (
            <div className="rounded-3xl bg-white p-8 text-center text-sm text-gray-400">
              불러오는 중...
            </div>
          ) : data.friends.length === 0 ? (
            <div className="rounded-3xl bg-white p-8 text-center">
              <div className="text-4xl">
                👥
              </div>

              <p className="mt-3 text-sm text-gray-500">
                아직 친구가 없습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.friends.map(
                (friend) => (
                  <Link
                    key={friend.id}
                    href={`/friends/${friend.id}`}
                    className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xl">
                        👤
                      </div>

                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">
                          {friend.name}
                        </p>

                        <p className="truncate text-xs text-gray-400">
                          {friend.email}
                        </p>

                        <p className="mt-1 text-[11px] font-bold text-orange-500">
                          취향 비교 · 같이 먹기
                        </p>
                      </div>
                    </div>

                    <span className="text-xl text-gray-300">
                      ›
                    </span>
                  </Link>
                )
              )}
            </div>
          )}
        </section>


        {/* 보낸 친구 요청 */}
        {data.outgoingRequests.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 font-bold">
              보낸 친구 요청
            </h2>

            <div className="space-y-2">
              {data.outgoingRequests.map(
                (item) => (
                  <div
                    key={item.friendshipId}
                    className="rounded-2xl bg-white px-4 py-3"
                  >
                    <p className="text-sm font-medium">
                      {item.name}
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      수락 대기 중
                    </p>
                  </div>
                )
              )}
            </div>
          </section>
        )}


        {/* 보낸 공통메뉴 요청 */}
        {recommendationData.outgoingRequests.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 font-bold">
              보낸 같이 먹기 요청
            </h2>

            <div className="space-y-2">
              {recommendationData.outgoingRequests.map(
                (item) => (
                  <div
                    key={item.sessionId}
                    className="rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3"
                  >
                    <p className="text-sm font-bold text-gray-800">
                      {item.name}님
                    </p>

                    <p className="mt-1 text-xs text-orange-500">
                      공통메뉴 추천 수락 대기 중
                    </p>
                  </div>
                )
              )}
            </div>
          </section>
        )}

      </div>
    </main>
  );
}
