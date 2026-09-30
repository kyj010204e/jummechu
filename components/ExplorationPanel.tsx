"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const ENABLED_KEY = "jummechu_exploration_enabled_v1";
const LAST_AUTO_KEY = "jummechu_exploration_last_auto_v1";
const LOCATION_KEY = "jummechu_location";
const AUTO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DISTANCE_METERS = 5_000;
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

type ExplorationPlace = {
  menu: ExplorationMenu;
  place: LocationSearchResult | null;
  distance: number | null;
};

type StoredLocation = {
  latitude: number;
  longitude: number;
};

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

function formatDistance(distance: number | null) {
  if (distance === null) return "거리 미확인";
  if (distance < 1_000) return `${distance}m`;
  return `${(distance / 1_000).toFixed(distance < 10_000 ? 1 : 0)}km`;
}

function buildNaverMapLink(place: LocationSearchResult, menuName: string) {
  const query = [place.name, place.roadAddress || place.jibunAddress, menuName]
    .filter(Boolean)
    .join(" ");

  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
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
        const menus = (menuData.explorationMenus ?? []).slice(0, menuCount);

        if (menus.length === 0) {
          setPlaces([]);
          setError(menuData.message ?? "지금은 새로운 탐험 메뉴를 찾지 못했어요.");
          return;
        }

        const resolved = await Promise.all(
          menus.map(async (menu): Promise<ExplorationPlace> => {
            const params = new URLSearchParams({
              query: menu.name,
              latitude: String(location.latitude),
              longitude: String(location.longitude),
            });

            try {
              const response = await fetch(`/api/location-search?${params.toString()}`, {
                cache: "no-store",
                signal: controller.signal,
              });

              const data = (await response.json()) as LocationSearchResponse;

              if (!response.ok) {
                return { menu, place: null, distance: null };
              }

              const candidates = (data.results ?? [])
                .filter((place) => place.source === "local")
                .map((place) => ({
                  place,
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
                .filter((item) => item.distance <= MAX_DISTANCE_METERS)
                .sort((a, b) => a.distance - b.distance);

              const best = candidates[0];

              return {
                menu,
                place: best?.place ?? null,
                distance: best?.distance ?? null,
              };
            } catch (searchError) {
              if (controller.signal.aborted) throw searchError;
              return { menu, place: null, distance: null };
            }
          })
        );

        if (controller.signal.aborted) return;

        setPlaces(resolved);

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
                  좋아할 가능성은 유지하면서 다른 요리권·메뉴 계열을 조금 섞어봤어요.
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
                  켜두면 평소 추천과 별도로 최대 2개의 탐험 메뉴를 보여줘요.
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
                <p className="mt-2 text-xs text-gray-400">새로운 취향을 찾는 중...</p>
              </div>
            )}

            {!loading && error && (
              <div className="mt-3 rounded-2xl bg-gray-50 p-4 text-xs leading-5 text-gray-500">
                {error}
              </div>
            )}

            {!loading && !error && visiblePlaces.length > 0 && (
              <div className="mt-3 space-y-3">
                {visiblePlaces.map(({ menu, place, distance }) => (
                  <article
                    key={menu.id}
                    className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-flex rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-black text-white">
                          ✨ 한번 도전해봐요
                        </span>

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

                    {place ? (
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

                        <a
                          href={buildNaverMapLink(place, menu.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-violet-700"
                        >
                          이 메뉴 한번 도전해보기 →
                        </a>
                      </div>
                    ) : (
                      <p className="mt-3 border-t border-violet-100 pt-3 text-[10px] leading-4 text-gray-400">
                        5km 안에서 이 메뉴를 명확히 검색할 수 있는 식당은 찾지 못했어요. 메뉴 자체는 탐험 후보로 기억해둘게요.
                      </p>
                    )}
                  </article>
                ))}
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
