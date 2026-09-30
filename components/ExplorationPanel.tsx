"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getSemanticRestaurantSearchAliases,
} from "@/lib/restaurant-search-terms";

const ENABLED_KEY = "jummechu_exploration_enabled_v1";
const LAST_AUTO_KEY = "jummechu_exploration_last_auto_v1";
const LOCATION_KEY = "jummechu_location";
const AUTO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const PRIMARY_DISTANCE_METERS = 5_000;
const EXTENDED_DISTANCE_METERS = 8_000;
const RELOAD_COOLDOWN_MS = 10_000;

type ExplorationMenu = {
  id: string;
  name: string;
  cuisineType: string | null;
  foodType: string | null;
  family: string;
  compatibilityScore: number;
  noveltyScore: number;
  explorationScore: number;
  anchor: string | null;
  reason: string;
  isExploration: true;
};

type ExplorationResponse = {
  explorationMenus?: ExplorationMenu[];
  message?: string;
};

type LocationSearchResult = {
  id: string;
  name: string;
  roadAddress: string;
  jibunAddress: string;
  category: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  source: "geocode" | "local";
};

type LocationSearchResponse = {
  results?: LocationSearchResult[];
  message?: string;
};

type MatchKind = "exact" | "alias" | "related";

type ExplorationPlace = {
  menu: ExplorationMenu;
  place: LocationSearchResult;
  distance: number;
  matchKind: MatchKind;
  extendedSearch: boolean;
};

type StoredLocation = {
  latitude: number;
  longitude: number;
};

type SearchHit = {
  place: LocationSearchResult;
  distance: number;
  matchKind: MatchKind;
};

function getMatchConfidenceMeta(kind: MatchKind) {
  if (kind === "exact") {
    return {
      label: "메뉴명 직접 검색",
      className: "bg-emerald-100 text-emerald-700",
    };
  }

  if (kind === "alias") {
    return {
      label: "유사 메뉴명 기준",
      className: "bg-blue-100 text-blue-700",
    };
  }

  return {
    label: "넓은 계열 기준",
    className: "bg-amber-100 text-amber-700",
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const earthRadius = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadius * c);
}

function getStoredLocation(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredLocation>;
    const latitude = Number(parsed.latitude);
    const longitude = Number(parsed.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }

    return { latitude, longitude };
  } catch {
    return null;
  }
}

function formatDistance(distance: number) {
  if (distance < 1_000) return `${distance}m`;
  return `${(distance / 1_000).toFixed(distance < 10_000 ? 1 : 0)}km`;
}

function buildNaverMapLink(place: LocationSearchResult, menuName: string) {
  const query = [place.name, place.roadAddress || place.jibunAddress, menuName]
    .filter(Boolean)
    .join(" ");

  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function addQuery(
  target: Array<{ query: string; kind: MatchKind }>,
  seen: Set<string>,
  query: string | null | undefined,
  kind: MatchKind
) {
  const normalized = query?.trim().replace(/\s+/g, " ");

  if (!normalized || seen.has(normalized)) return;

  seen.add(normalized);
  target.push({ query: normalized, kind });
}

/*
 * NAVER 업체명/메뉴 표기 차이 때문에 실제 가게가 있어도 검색에서 빠지는 경우를 줄입니다.
 * 정확한 메뉴명을 가장 먼저 사용하고, 표기 동의어 -> 계열 검색 순서로 넓힙니다.
 */
function buildSearchQueries(menu: ExplorationMenu) {
  const queries: Array<{ query: string; kind: MatchKind }> = [];
  const seen = new Set<string>();

  addQuery(queries, seen, menu.name, "exact");

  /*
   * 일반 추천과 탐험 추천이 같은 검색 정규화 규칙을 사용합니다.
   *
   * 예:
   * 돼지고기수육       -> 수육
   * 치즈돈가스         -> 돈가스 / 돈까스
   * 돼지고기김치찌개   -> 김치찌개
   * 고등어양념구이     -> 고등어구이
   * 김치볶음밥         -> 볶음밥
   *
   * 화면에는 Food Master의 원래 이름을 유지하고,
   * 실제 주변 음식점 검색어만 더 일반적인 표현으로 넓힙니다.
   */
  for (
    const alias
    of getSemanticRestaurantSearchAliases(
      menu.name
    )
  ) {
    addQuery(
      queries,
      seen,
      alias,
      "alias"
    );
  }

  if (menu.foodType && menu.foodType !== "기타") {
    addQuery(queries, seen, menu.foodType, "alias");
  }

  if (
    menu.family &&
    menu.family !== "기타" &&
    menu.family !== menu.foodType
  ) {
    addQuery(queries, seen, menu.family, "alias");
  }

  if (menu.cuisineType && (menu.foodType || menu.family !== "기타")) {
    addQuery(
      queries,
      seen,
      `${menu.cuisineType} ${menu.foodType || menu.family}`,
      "related"
    );
  }

  return queries.slice(0, 6);
}

export default function ExplorationPanel() {
  const pathname = usePathname();
  const router = useRouter();

  const [manualEnabled, setManualEnabled] = useState(false);
  const [autoExplorationActive, setAutoExplorationActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [loadedSettings, setLoadedSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [places, setPlaces] = useState<ExplorationPlace[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [reloadCooldown, setReloadCooldown] = useState(0);
  const [feedbackByFoodId, setFeedbackByFoodId] = useState<
    Record<string, 1 | -1>
  >({});
  const [feedbackSavingId, setFeedbackSavingId] = useState<string | null>(null);
  const [feedbackMessageByFoodId, setFeedbackMessageByFoodId] = useState<
    Record<string, string>
  >({});

  const reloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPersonalMap = pathname === "/map";
  const active = manualEnabled || autoExplorationActive;

  useEffect(() => {
    if (!isPersonalMap) return;

    try {
      const storedEnabled = localStorage.getItem(ENABLED_KEY) === "true";
      setManualEnabled(storedEnabled);

      const lastAutoRaw = localStorage.getItem(LAST_AUTO_KEY);
      const lastAuto = lastAutoRaw ? Number(lastAutoRaw) : 0;
      const due =
        !Number.isFinite(lastAuto) ||
        lastAuto <= 0 ||
        Date.now() - lastAuto >= AUTO_INTERVAL_MS;

      setAutoExplorationActive(due);

      if (due) {
        setOpen(true);
      }
    } finally {
      setLoadedSettings(true);
    }
  }, [isPersonalMap]);

  useEffect(() => {
    if (!loadedSettings || !isPersonalMap) return;
    localStorage.setItem(ENABLED_KEY, manualEnabled ? "true" : "false");
  }, [manualEnabled, loadedSettings, isPersonalMap]);

  useEffect(() => {
    if (!loadedSettings || !isPersonalMap || !active) {
      if (loadedSettings && !active) {
        setPlaces([]);
        setError("");
      }
      return;
    }

    const controller = new AbortController();

    /*
     * 한 번의 탐험에서 NAVER 검색을 과도하게 호출하지 않도록
     * 위치 검색 요청에 상한을 둡니다. 결과 1~2개를 찾으면 그 전에 종료됩니다.
     */
    let remainingSearchBudget = 24;

    async function searchQuery(
      location: StoredLocation,
      query: string,
      kind: MatchKind
    ): Promise<SearchHit[]> {
      if (remainingSearchBudget <= 0) {
        return [];
      }

      remainingSearchBudget -= 1;

      const params = new URLSearchParams({
        query,
        latitude: String(location.latitude),
        longitude: String(location.longitude),
      });

      const response = await fetch(`/api/location-search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });

      const data = (await response.json()) as LocationSearchResponse;

      if (!response.ok) return [];

      return (data.results ?? [])
        .filter((place) => place.source === "local")
        .map((place) => ({
          place,
          kind,
          distance:
            typeof place.distance === "number"
              ? place.distance
              : calculateDistanceMeters(
                  location.latitude,
                  location.longitude,
                  place.latitude,
                  place.longitude
                ),
        }))
        .filter((item) => Number.isFinite(item.distance))
        .map((item) => ({
          place: item.place,
          distance: item.distance,
          matchKind: item.kind,
        }));
    }

    async function resolveNearbyPlace(
      location: StoredLocation,
      menu: ExplorationMenu
    ): Promise<ExplorationPlace | null> {
      const queries = buildSearchQueries(menu);
      const hits = new Map<string, SearchHit>();

      for (const { query, kind } of queries) {
        if (controller.signal.aborted) return null;

        try {
          const results = await searchQuery(location, query, kind);

          for (const result of results) {
            const key = `${result.place.name}|${
              result.place.roadAddress || result.place.jibunAddress
            }`;

            const current = hits.get(key);

            if (!current || result.distance < current.distance) {
              hits.set(key, result);
            }
          }

          /*
           * 정확/동의어 검색에서 5km 안의 가게를 찾으면 즉시 종료합니다.
           * 대전처럼 후보가 적은 지역에서만 뒤의 넓은 검색을 수행합니다.
           */
          const nearby = [...hits.values()]
            .filter(
              (item) =>
                item.distance <= PRIMARY_DISTANCE_METERS &&
                item.matchKind !== "related"
            )
            .sort((a, b) => a.distance - b.distance)[0];

          if (nearby) {
            return {
              menu,
              place: nearby.place,
              distance: nearby.distance,
              matchKind: nearby.matchKind,
              extendedSearch: false,
            };
          }
        } catch (searchError) {
          if (controller.signal.aborted) throw searchError;
        }
      }

      /*
       * 5km 안에서 못 찾았을 때만 8km까지 확장합니다.
       * 정확 메뉴/동의어 결과를 우선하고, 마지막에 관련 계열 결과를 허용합니다.
       */
      const extended = [...hits.values()]
        .filter((item) => item.distance <= EXTENDED_DISTANCE_METERS)
        .sort((a, b) => {
          const priority = (kind: MatchKind) =>
            kind === "exact" ? 0 : kind === "alias" ? 1 : 2;

          const priorityDiff = priority(a.matchKind) - priority(b.matchKind);
          return priorityDiff !== 0 ? priorityDiff : a.distance - b.distance;
        })[0];

      if (!extended) return null;

      return {
        menu,
        place: extended.place,
        distance: extended.distance,
        matchKind: extended.matchKind,
        extendedSearch: true,
      };
    }

    async function loadExploration() {
      try {
        setLoading(true);
        setError("");

        const location = getStoredLocation();

        if (!location) {
          setError("먼저 추천 기준 위치를 설정해주세요.");
          return;
        }

        const menuResponse = await fetch(`/api/exploration?variant=${reloadKey}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (menuResponse.status === 401) {
          router.replace("/login");
          return;
        }

        const menuData = (await menuResponse.json()) as ExplorationResponse;

        if (!menuResponse.ok) {
          throw new Error(menuData.message ?? "취향 탐험 메뉴를 불러오지 못했습니다.");
        }

        const menuCount = manualEnabled ? 2 : 1;
        const menus = menuData.explorationMenus ?? [];

        if (menus.length === 0) {
          setPlaces([]);
          setError(menuData.message ?? "지금은 새로운 탐험 메뉴를 찾지 못했어요.");
          return;
        }

        const resolved: ExplorationPlace[] = [];

        for (const menu of menus) {
          if (controller.signal.aborted) return;

          const resolvedPlace = await resolveNearbyPlace(location, menu);

          if (!resolvedPlace) continue;

          resolved.push(resolvedPlace);

          if (resolved.length >= menuCount) {
            break;
          }
        }

        if (controller.signal.aborted) return;

        setPlaces(resolved);

        if (resolved.length === 0) {
          setError(
            "주변 5km를 먼저 찾고 8km까지 넓혀봤지만 바로 도전할 탐험 메뉴를 찾지 못했어요. 다른 탐험 메뉴로 다시 찾아보세요."
          );
          return;
        }

        /* 실제 탐험 카드를 보여준 경우에만 주 1회 자동 탐험 시각을 기록합니다. */
        if (autoExplorationActive && !manualEnabled) {
          localStorage.setItem(LAST_AUTO_KEY, String(Date.now()));
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "취향 탐험 추천을 불러오지 못했습니다."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadExploration();

    return () => controller.abort();
  }, [
    active,
    autoExplorationActive,
    isPersonalMap,
    loadedSettings,
    manualEnabled,
    reloadKey,
    router,
  ]);

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearInterval(reloadTimerRef.current);
      }
    };
  }, []);

  function requestAnotherExploration() {
    if (reloadCooldown > 0) return;

    setReloadKey((current) => current + 1);
    setReloadCooldown(Math.ceil(RELOAD_COOLDOWN_MS / 1000));

    if (reloadTimerRef.current) {
      clearInterval(reloadTimerRef.current);
    }

    reloadTimerRef.current = setInterval(() => {
      setReloadCooldown((current) => {
        if (current <= 1) {
          if (reloadTimerRef.current) {
            clearInterval(reloadTimerRef.current);
            reloadTimerRef.current = null;
          }
          return 0;
        }

        return current - 1;
      });
    }, 1000);
  }

  async function submitFeedback(menu: ExplorationMenu, rating: 1 | -1) {
    if (feedbackSavingId) return;

    try {
      setFeedbackSavingId(menu.id);
      setFeedbackMessageByFoodId((current) => ({
        ...current,
        [menu.id]: "",
      }));

      const response = await fetch("/api/recommendation-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          foodId: menu.id,
          rating,
          source: "exploration",
        }),
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
        throw new Error(result.message ?? "평가를 반영하지 못했습니다.");
      }

      setFeedbackByFoodId((current) => ({
        ...current,
        [menu.id]: rating,
      }));

      setFeedbackMessageByFoodId((current) => ({
        ...current,
        [menu.id]:
          result.message ??
          (rating === 1
            ? "다음 추천에 좋아요 취향을 반영할게요."
            : "다음 추천에서 비슷한 메뉴 비중을 낮출게요."),
      }));
    } catch (feedbackError) {
      setFeedbackMessageByFoodId((current) => ({
        ...current,
        [menu.id]:
          feedbackError instanceof Error
            ? feedbackError.message
            : "평가를 반영하지 못했습니다.",
      }));
    } finally {
      setFeedbackSavingId(null);
    }
  }

  const visiblePlaces = useMemo(() => places.filter((item) => item.menu), [places]);

  if (!isPersonalMap || !loadedSettings) {
    return null;
  }

  return (
    <div className="fixed bottom-24 right-4 z-[80] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {open && (
        <section className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-2xl shadow-violet-200/40">
          <div className="bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 p-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-black text-violet-100">✨ 취향 탐험</p>
                  {autoExplorationActive && !manualEnabled && (
                    <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold text-white">
                      이번 주 탐험
                    </span>
                  )}
                </div>

                <h2 className="mt-1 text-lg font-black">익숙한 취향에서 한 걸음만</h2>
                <p className="mt-1 text-[11px] leading-5 text-violet-100/90">
                  취향은 유지하고, 주변 5km를 우선 탐색한 뒤 부족하면 8km까지 넓혀봐요.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-black text-white transition hover:bg-white/20"
                aria-label="취향 탐험 닫기"
              >
                ×
              </button>
            </div>
          </div>

          <div className="p-4">
            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl bg-violet-50 p-3">
              <div>
                <p className="text-xs font-black text-violet-800">새로운 메뉴도 추천받기</p>
                <p className="mt-1 text-[10px] leading-4 text-violet-500">
                  주변에서 실제로 도전할 수 있는 새로운 메뉴를 최대 2개 보여줘요.
                </p>
              </div>

              <input
                type="checkbox"
                checked={manualEnabled}
                onChange={(event) => {
                  setManualEnabled(event.target.checked);
                  if (event.target.checked) setOpen(true);
                }}
                className="mt-0.5 h-5 w-5 accent-violet-600"
              />
            </label>

            {loading && (
              <div className="py-7 text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-4 border-violet-100 border-t-violet-600" />
                <p className="mt-2 text-xs text-gray-400">주변에서 도전할 메뉴를 찾는 중...</p>
              </div>
            )}

            {!loading && error && (
              <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-xs leading-5 text-gray-500">
                {error}
              </div>
            )}

            {!loading && !error && visiblePlaces.length > 0 && (
              <div className="mt-3 space-y-3">
                {visiblePlaces.map(({ menu, place, distance, matchKind, extendedSearch }) => {
                  const feedback = feedbackByFoodId[menu.id];
                  const feedbackMessage = feedbackMessageByFoodId[menu.id];
                  const saving = feedbackSavingId === menu.id;

                  return (
                    <article
                      key={menu.id}
                      className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-1.5">
                            <span className="inline-flex rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-black text-white">
                              ✨ 한번 도전해봐요
                            </span>

                            {extendedSearch && (
                              <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-600">
                                8km 확장
                              </span>
                            )}

                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${
                                getMatchConfidenceMeta(
                                  matchKind
                                ).className
                              }`}
                            >
                              {getMatchConfidenceMeta(
                                matchKind
                              ).label}
                            </span>
                          </div>

                          <h3 className="mt-2 text-base font-black text-gray-900">{menu.name}</h3>

                          <p className="mt-1 text-[11px] font-bold text-violet-600">
                            취향 적합도 {menu.compatibilityScore} · 새로움 {menu.noveltyScore}
                          </p>
                        </div>

                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-lg font-black text-white shadow-md shadow-violet-200">
                          {menu.explorationScore}
                        </div>
                      </div>

                      <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[11px] leading-5 text-gray-600">
                        {menu.reason}
                      </p>

                      <div className="mt-3 border-t border-violet-100 pt-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-gray-800">{place.name}</p>
                            <p className="mt-1 truncate text-[10px] text-gray-400">
                              {place.roadAddress || place.jibunAddress}
                            </p>
                          </div>

                          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-violet-600 shadow-sm">
                            📍 {formatDistance(distance)}
                          </span>
                        </div>

                        {matchKind === "related" && (
                          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-700">
                            넓은 메뉴 계열 검색으로 찾은 후보예요. 실제로 {menu.name}을 판매하는지는 네이버 메뉴판에서 한 번 확인해주세요.
                          </p>
                        )}

                        <a
                          href={buildNaverMapLink(place, menu.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-violet-700"
                        >
                          이 메뉴 한번 도전해보기 →
                        </a>

                        <div className="mt-3 rounded-xl bg-white/80 p-3">
                          <p className="text-[10px] font-bold text-gray-500">
                            먹어본 뒤 어땠는지 알려주세요
                          </p>
                          <p className="mt-1 text-[10px] leading-4 text-gray-400">
                            평가는 다음 개인 추천과 친구 공통 추천의 취향 벡터에 조금씩 반영돼요.
                          </p>

                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void submitFeedback(menu, 1)}
                              className={`rounded-xl px-3 py-2 text-xs font-black transition disabled:cursor-wait disabled:opacity-60 ${
                                feedback === 1
                                  ? "bg-emerald-500 text-white"
                                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              }`}
                            >
                              👍 좋았어요
                            </button>

                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void submitFeedback(menu, -1)}
                              className={`rounded-xl px-3 py-2 text-xs font-black transition disabled:cursor-wait disabled:opacity-60 ${
                                feedback === -1
                                  ? "bg-rose-500 text-white"
                                  : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                              }`}
                            >
                              👎 별로였어요
                            </button>
                          </div>

                          {feedbackMessage && (
                            <p className="mt-2 text-[10px] leading-4 text-violet-600">
                              {feedbackMessage}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {active && !loading && (
              <button
                type="button"
                onClick={requestAnotherExploration}
                disabled={reloadCooldown > 0}
                className="mt-3 w-full rounded-xl border border-violet-100 bg-white py-2.5 text-xs font-bold text-violet-600 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:text-violet-300"
              >
                {reloadCooldown > 0
                  ? `다시 탐험하기 · ${reloadCooldown}초`
                  : "✨ 다른 탐험 메뉴 보기"}
              </button>
            )}

            {!manualEnabled && autoExplorationActive && (
              <p className="mt-3 text-center text-[10px] leading-4 text-gray-400">
                자동 탐험은 약 일주일에 한 번만 보여줘요. 계속 보고 싶다면 위 옵션을 켜주세요.
              </p>
            )}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-3 text-xs font-black shadow-xl transition ${
          active
            ? "border-violet-500 bg-violet-600 text-white shadow-violet-200 hover:bg-violet-700"
            : "border-violet-100 bg-white text-violet-600 shadow-gray-200 hover:bg-violet-50"
        }`}
      >
        <span>✨</span>
        <span>취향 탐험</span>
        {active && <span className="h-2 w-2 rounded-full bg-emerald-300" />}
      </button>
    </div>
  );
}
