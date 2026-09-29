"use client";

import Link from "next/link";
import {
  AppHeader,
  AppShell,
  EmptyState,
  PageIntro,
  SectionHeader,
} from "@/components/JummechuUI";
import {
  useCallback,
  useEffect,
  useState,
} from "react";


type SessionItem = {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  acceptedAt?: string | null;
  completedAt?: string | null;
};


type RecommendationResponse = {
  activeSessions: SessionItem[];
  completedSessions: SessionItem[];
  message?: string;
};


type Tab = "active" | "history";


function formatDate(value?: string | null) {
  if (!value) return "날짜 없음";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}


export default function FriendHistoryPage() {
  const [tab, setTab] =
    useState<Tab>("history");

  const [data, setData] =
    useState<RecommendationResponse>({
      activeSessions: [],
      completedSessions: [],
    });

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");


  const loadData =
    useCallback(async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/friend-recommendations",
          { cache: "no-store" }
        );

        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ??
              "같이 먹기 기록을 불러오지 못했습니다."
          );
        }

        setData({
          activeSessions:
            result.activeSessions ?? [],
          completedSessions:
            result.completedSessions ?? [],
        });
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "같이 먹기 기록을 불러오지 못했습니다."
        );
      } finally {
        setLoading(false);
      }
    }, []);


  useEffect(() => {
    void loadData();
  }, [loadData]);


  const sessions =
    tab === "active"
      ? data.activeSessions
      : data.completedSessions;


  return (
    <AppShell>
      <AppHeader
        eyebrow="HISTORY"
        title="같이 먹기"
        backHref="/friends"
        backLabel="친구로 돌아가기"
      />

      <div className="pb-24">
        <section className="px-5 pb-2 pt-6">
          <PageIntro
            eyebrow="FRIEND MATCH"
            title="같이 먹기 기록"
            description="진행 중인 추천은 이어서 보고, 완료한 추천은 히스토리에서 다시 확인할 수 있어요."
          />
        </section>

        <section className="px-5 pt-5">
          <div className="grid grid-cols-2 rounded-2xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                tab === "active"
                  ? "bg-white text-gray-950 shadow-sm"
                  : "text-gray-400"
              }`}
            >
              진행 중 {data.activeSessions.length}
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
                tab === "history"
                  ? "bg-white text-gray-950 shadow-sm"
                  : "text-gray-400"
              }`}
            >
              히스토리 {data.completedSessions.length}
            </button>
          </div>
        </section>

        <section className="px-5 pt-6">
          <SectionHeader
            title={tab === "active" ? "진행 중인 같이 먹기" : "완료한 같이 먹기"}
            subtitle={
              tab === "active"
                ? "추천을 열어보고 완료하면 히스토리로 이동해요."
                : "완료했던 추천을 다시 열어볼 수 있어요."
            }
          />

          <div className="mt-3">
            {loading ? (
              <div className="rounded-3xl bg-gray-50 p-8 text-center text-sm text-gray-400">
                불러오는 중...
              </div>
            ) : error ? (
              <div className="rounded-3xl bg-red-50 p-5 text-sm leading-6 text-red-500">
                {error}
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                emoji={tab === "active" ? "🍚" : "🕘"}
                title={
                  tab === "active"
                    ? "진행 중인 같이 먹기가 없어요"
                    : "아직 완료한 같이 먹기가 없어요"
                }
                description={
                  tab === "active"
                    ? "친구에게 공통메뉴 추천을 요청해보세요."
                    : "같이 먹기를 완료하면 여기에 기록돼요."
                }
              />
            ) : (
              <div className="space-y-3">
                {sessions.map((item) => (
                  <Link
                    key={item.sessionId}
                    href={`/map/friend?sessionId=${item.sessionId}`}
                    className={`flex items-center justify-between rounded-3xl p-4 transition active:scale-[0.99] ${
                      tab === "active"
                        ? "bg-[#0f172a] text-white shadow-sm"
                        : "border border-gray-100 bg-white text-gray-900 shadow-sm hover:border-orange-100"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={
                          tab === "active"
                            ? "text-[11px] font-black text-orange-300"
                            : "text-[11px] font-black text-orange-500"
                        }>
                          {tab === "active" ? "진행 중" : "완료"}
                        </span>
                        <span className={
                          tab === "active"
                            ? "text-[11px] text-white/35"
                            : "text-[11px] text-gray-300"
                        }>
                          ·
                        </span>
                        <span className={
                          tab === "active"
                            ? "truncate text-[11px] text-white/55"
                            : "truncate text-[11px] text-gray-400"
                        }>
                          {tab === "active"
                            ? formatDate(item.acceptedAt)
                            : formatDate(item.completedAt)}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-sm font-black">
                        👥 {item.name}님과 같이 먹기
                      </p>
                      <p className={
                        tab === "active"
                          ? "mt-1 text-xs text-white/50"
                          : "mt-1 text-xs text-gray-400"
                      }>
                        {tab === "active" ? "공통메뉴 추천 이어보기" : "추천 다시 보기"}
                      </p>
                    </div>
                    <span className={
                      tab === "active"
                        ? "text-2xl text-white/30"
                        : "text-2xl text-gray-300"
                    }>
                      ›
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
