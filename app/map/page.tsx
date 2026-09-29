"use client";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { parseCoordinate } from "@/lib/validation";
import {
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* =========================================================
   타입
========================================================= */
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
  success?: boolean;
  message?: string;
  results?: LocationSearchResult[];
};

type LocationData = {
  latitude: number;
  longitude: number;
};
type SavedLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};
type BusinessStatus =
  | "OPEN"
  | "BREAK"
  | "CLOSED"
  | "CLOSED_TODAY"
  | "UNKNOWN";

type BusinessHoursInfo = {
  status: BusinessStatus;
  label: string;
  detail: string | null;

  todayOpen: string | null;
  todayClose: string | null;

  breakStart: string | null;
  breakEnd: string | null;

  nextOpenText: string | null;

  source: string | null;
  verifiedAt: string | null;
};

type Restaurant = {
  id: string;
  name: string;
  category: string;

  /*
   * 서버의 음식점/술집 분류.
   * 일부 오래된 응답에도 안전하게 동작하도록 optional로 둡니다.
   */
  venueType?: "restaurant" | "bar";
  venueTypeLabel?: "음식점" | "술집";

  address: string;
  roadAddress: string;

  latitude: number;
  longitude: number;

  distance: number;

  matchedPreferences: string[];

  recommendedMenuName:
    string | null;

  recommendedMenuScore:
    number | null;

  preferenceScore: number;
  distanceScore: number;
  recommendScore: number;

  priceMenuName: string | null;

  priceKrw: number | null;

  directPriceKrw: number | null;

  regionalAveragePriceKrw:
    number | null;

  restaurantMenuPriceId:
    string | null;

  priceSource:
    | "direct"
    | "regional"
    | "unknown";

  priceSourceLabel: string;

  businessHours: BusinessHoursInfo;
  recommendationEligible: boolean;

  /*
   * 주차 정보는 아직 데이터가 없는 식당이 많을 수 있으므로
   * null/undefined를 "미확인"으로 취급합니다.
   * 추후 restaurant_facilities 같은 DB 소스를 연결하면
   * 개인설정의 주차 필터가 그대로 동작합니다.
   */
  parkingAvailable?: boolean | null;
  parkingSourceLabel?: string | null;
};

type RecommendedMenu = {
  name: string;
  family: string;
  score: number;
  anchor: string | null;
  mmrScore: number | null;
};

type RestaurantResponse = {
  region: {
    area1: string;
    area2: string;
    area3: string;
    displayName: string;
  };

  preferences: string[];

  recommendationMode:
    | "embedding"
    | "category";

  recommendedMenus: RecommendedMenu[];

  searchMenus: string[];

  restaurants: Restaurant[];

  message?: string;
};

type Mode =
  | "recommend"
  | "settings";

/* =========================================================
   API 응답 안전 보정

   음식점 검색 API가 일부 부가 필드(영업시간/가격 등)를
   내려주지 못해도 지도 화면 전체가 죽지 않도록 기본값을 채웁니다.
========================================================= */
const UNKNOWN_BUSINESS_HOURS: BusinessHoursInfo = {
  status: "UNKNOWN",
  label: "영업시간 미확인",
  detail: null,
  todayOpen: null,
  todayClose: null,
  breakStart: null,
  breakEnd: null,
  nextOpenText: null,
  source: null,
  verifiedAt: null,
};

function normalizeRestaurant(
  restaurant: Restaurant
): Restaurant {
  const businessHours =
    restaurant.businessHours ??
    UNKNOWN_BUSINESS_HOURS;

  return {
    ...restaurant,

    matchedPreferences:
      Array.isArray(restaurant.matchedPreferences)
        ? restaurant.matchedPreferences
        : [],

    recommendedMenuName:
      restaurant.recommendedMenuName ?? null,

    recommendedMenuScore:
      restaurant.recommendedMenuScore ?? null,

    priceMenuName:
      restaurant.priceMenuName ?? null,

    priceKrw:
      restaurant.priceKrw ?? null,

    directPriceKrw:
      restaurant.directPriceKrw ?? null,

    regionalAveragePriceKrw:
      restaurant.regionalAveragePriceKrw ?? null,

    restaurantMenuPriceId:
      restaurant.restaurantMenuPriceId ?? null,

    priceSource:
      restaurant.priceSource ?? "unknown",

    priceSourceLabel:
      restaurant.priceSourceLabel ?? "가격 미확인",

    businessHours: {
      ...UNKNOWN_BUSINESS_HOURS,
      ...businessHours,
    },

    /*
     * false가 명시된 경우만 추천 제외.
     * 필드 자체가 누락된 오래된/간소화 API 응답은
     * UNKNOWN 영업시간으로 간주하고 추천 후보에는 유지합니다.
     */
    recommendationEligible:
      restaurant.recommendationEligible !== false,

    parkingAvailable:
      restaurant.parkingAvailable ?? null,

    parkingSourceLabel:
      restaurant.parkingSourceLabel ?? null,
  };
}

/*
 * 음식점 API에서는 최대 5km 후보를 받아옵니다.
 * 실제 추천 순서는 사용자가 정한
 * 메뉴 취향 / 거리 가중치로 프론트에서 다시 계산합니다.
 */
const MAX_RESTAURANT_SEARCH_RADIUS_KM = 5;

const RECOMMENDATION_SETTINGS_KEY =
  "jummechu_recommendation_settings_v1";

const RESTAURANT_REFRESH_COOLDOWN_SECONDS = 10;


function calculateWeightedRecommendScore(
  restaurant: Restaurant,
  preferenceWeight: number
) {
  const safePreferenceWeight =
    Math.min(
      100,
      Math.max(
        0,
        preferenceWeight
      )
    );

  const distanceWeight =
    100 -
    safePreferenceWeight;

  return Math.round(
    restaurant.preferenceScore *
      (
        safePreferenceWeight /
        100
      )
    +
    restaurant.distanceScore *
      (
        distanceWeight /
        100
      )
  );
}

/* =========================================================
   NAVER MAP 타입
========================================================= */

type NaverLatLng = {
  lat(): number;
  lng(): number;
};
type NaverPoint = object;
type NaverSize = object;

type NaverLatLngBounds = {
  extend(position: NaverLatLng): void;
};

interface NaverMapInstance {
  setCenter(position: NaverLatLng): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: NaverLatLngBounds): void;

  getCenter(): NaverLatLng;
}

interface NaverMarkerInstance {
  setPosition(position: NaverLatLng): void;
  setMap(map: NaverMapInstance | null): void;
}

type NaverEventListener = object;

interface NaverMapsApi {
  LatLng: new (
    latitude: number,
    longitude: number
  ) => NaverLatLng;

  LatLngBounds: new (
    sw: NaverLatLng,
    ne: NaverLatLng
  ) => NaverLatLngBounds;

  Point: new (
    x: number,
    y: number
  ) => NaverPoint;

  Size: new (
    width: number,
    height: number
  ) => NaverSize;

  Map: new (
    element: HTMLElement,
    options: {
      center: NaverLatLng;
      zoom: number;
    }
  ) => NaverMapInstance;

  Marker: new (options: {
    position: NaverLatLng;

    map: NaverMapInstance;

    zIndex?: number;

    icon?: {
      content: string;
      size?: NaverSize;
      anchor?: NaverPoint;
    };
  }) => NaverMarkerInstance;

  Event: {
    addListener(
      target: object,
      eventName: string,
      listener: () => void
    ): NaverEventListener;

    removeListener(
      listener: NaverEventListener
    ): void;
  };
}

declare global {
  interface Window {
    naver?: {
      maps: NaverMapsApi;
    };

    navermap_authFailure?: () => void;
  }
}

/* =========================================================
   HTML 안전 처리
========================================================= */

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* =========================================================
   PAGE
========================================================= */

export default function MapPage() {
  const router = useRouter();
  /* =======================================================
     STATE
  ======================================================= */

  const [locationSearchQuery, setLocationSearchQuery] =
    useState("");

  const [locationSearchLoading, setLocationSearchLoading] =
    useState(false);

  const [locationSearchError, setLocationSearchError] =
    useState("");

  const [locationSearchResults, setLocationSearchResults] =
    useState<LocationSearchResult[]>([]);

  const [savedLocations, setSavedLocations] =
  useState<SavedLocation[]>([]);

  const [showSaveLocation, setShowSaveLocation] =
    useState(false);

  const [saveLocationName, setSaveLocationName] =
    useState("");

  const [editingLocation, setEditingLocation] =
    useState<SavedLocation | null>(null);

  const [editingLocationName, setEditingLocationName] =
    useState("");

  const [showLocationManage, setShowLocationManage] =
    useState(false);

  const [location, setLocation] =
    useState<LocationData | null>(null);

  const [mode, setMode] =
    useState<Mode>("recommend");

  /*
   * 받은 친구 요청 개수
   *
   * 지도 화면에 머무는 동안 새 요청을 놓치지 않도록
   * 최초 진입 / 창 포커스 / 15초 간격으로 갱신합니다.
   */
  const [
    incomingFriendRequestCount,
    setIncomingFriendRequestCount,
  ] = useState(0);

  /*
   * 추천 가중치
   *
   * 사용자가 "메뉴 취향" 비율을 움직이면
   * 거리 비율은 자동으로 100 - 메뉴 취향이 됩니다.
   *
   * 기본값은 기존 점메추 추천과 동일한
   * 메뉴 취향 70% + 거리 30%입니다.
   */
  const [
    preferenceWeight,
    setPreferenceWeight,
  ] = useState(70);

  const distanceWeight =
    100 -
    preferenceWeight;

  /*
   * 개인설정 - 예산
   *
   * 예산은 점수에 섞지 않고 hard filter로만 사용합니다.
   */
  const [
    budgetEnabled,
    setBudgetEnabled,
  ] = useState(false);

  const [
    budgetKrw,
    setBudgetKrw,
  ] = useState(20_000);

  const [
    includeUnknownPrice,
    setIncludeUnknownPrice,
  ] = useState(true);

  /*
   * 개인설정 - 주차
   *
   * 주차 정보가 아직 없는 식당이 많을 수 있으므로
   * "미확인 식당 포함"을 기본값으로 둡니다.
   */
  const [
    parkingRequired,
    setParkingRequired,
  ] = useState(false);

  const [
    includeUnknownParking,
    setIncludeUnknownParking,
  ] = useState(true);

  /*
   * 점심/식사 추천에서는 술집을 기본 제외합니다.
   * 개인설정에서 사용자가 원할 때만 별도 구역으로 보여줍니다.
   */
  const [
    includeBars,
    setIncludeBars,
  ] = useState(false);

  const [
    recommendationSettingsLoaded,
    setRecommendationSettingsLoaded,
  ] = useState(false);

  const [mapLoaded, setMapLoaded] =
    useState(false);

  const [locationLoaded, setLocationLoaded] =
    useState(false);

  const [mapError, setMapError] =
    useState("");

  const [restaurants, setRestaurants] =
    useState<Restaurant[]>([]);

  const [restaurantLoading, setRestaurantLoading] =
    useState(false);

  const [restaurantError, setRestaurantError] =
    useState("");

  const [regionName, setRegionName] =
    useState("");

  const [
    recommendationMode,
    setRecommendationMode,
  ] = useState<
    "embedding" | "category"
  >("category");

  const [
    recommendedMenus,
    setRecommendedMenus,
  ] = useState<RecommendedMenu[]>(
    []
  );

  const [
    searchMenus,
    setSearchMenus,
  ] = useState<string[]>(
    []
  );

  const [
    restaurantRefreshKey,
    setRestaurantRefreshKey,
  ] = useState(0);

  const [
    restaurantRefreshCooldown,
    setRestaurantRefreshCooldown,
  ] = useState(0);

  const [
    businessHoursRestaurant,
    setBusinessHoursRestaurant,
  ] = useState<Restaurant | null>(null);

  const [
    showBusinessHoursModal,
    setShowBusinessHoursModal,
  ] = useState(false);

  const [
    businessHoursDay,
    setBusinessHoursDay,
  ] = useState(0);

  const [
    businessHoursOpen,
    setBusinessHoursOpen,
  ] = useState("11:00");

  const [
    businessHoursClose,
    setBusinessHoursClose,
  ] = useState("21:00");

  const [
    businessHoursBreakStart,
    setBusinessHoursBreakStart,
  ] = useState("");

  const [
    businessHoursBreakEnd,
    setBusinessHoursBreakEnd,
  ] = useState("");

  const [
    businessHoursClosed,
    setBusinessHoursClosed,
  ] = useState(false);

  const [
    businessHoursApplyAllDays,
    setBusinessHoursApplyAllDays,
  ] = useState(false);

  const [
    businessHoursSaving,
    setBusinessHoursSaving,
  ] = useState(false);

  const [
    businessHoursError,
    setBusinessHoursError,
  ] = useState("");

  /*
   * 가격 제보
   */
  const [
    priceReportRestaurant,
    setPriceReportRestaurant,
  ] = useState<Restaurant | null>(null);

  const [
    showPriceReportModal,
    setShowPriceReportModal,
  ] = useState(false);

  const [
    priceReportMenu,
    setPriceReportMenu,
  ] = useState("");

  const [
    priceReportPrice,
    setPriceReportPrice,
  ] = useState("");

  const [
    priceReportNote,
    setPriceReportNote,
  ] = useState("");

  const [
    priceReportSaving,
    setPriceReportSaving,
  ] = useState(false);

  const [
    priceReportError,
    setPriceReportError,
  ] = useState("");

  const [
    priceReportSuccess,
    setPriceReportSuccess,
  ] = useState("");

  /*
   * 현재 선택된 음식점
   */
  const [
    selectedRestaurantId,
    setSelectedRestaurantId,
  ] = useState<string | null>(null);

  /* =======================================================
     REF
  ======================================================= */

  const mapElementRef =
    useRef<HTMLDivElement | null>(null);

  const mapInstanceRef =
    useRef<NaverMapInstance | null>(null);

  const myMarkerRef =
    useRef<NaverMarkerInstance | null>(null);

  const restaurantMarkersRef =
    useRef<NaverMarkerInstance[]>([]);

  /*
   * NAVER Event listener 정리용
   */
  const markerListenersRef =
    useRef<NaverEventListener[]>([]);

  /*
   * 음식점 카드 DOM 저장
   */
  const restaurantCardRefs =
    useRef<
      Record<
        string,
        HTMLElement | null
      >
    >({});

  const clientId =
    process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;

  /* =======================================================
     친구 요청 알림 배지
  ======================================================= */

  useEffect(() => {
    let cancelled = false;

    async function loadFriendRequestCount() {
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
          !friendsResponse.ok ||
          !recommendationResponse.ok
        ) {
          return;
        }

        const friendsData =
          (await friendsResponse.json()) as {
            incomingRequests?: unknown[];
          };

        const recommendationData =
          (await recommendationResponse.json()) as {
            incomingRequests?: unknown[];
          };

        if (cancelled) {
          return;
        }

        const friendRequestCount =
          Array.isArray(
            friendsData.incomingRequests
          )
            ? friendsData.incomingRequests.length
            : 0;

        const recommendationRequestCount =
          Array.isArray(
            recommendationData.incomingRequests
          )
            ? recommendationData.incomingRequests.length
            : 0;

        setIncomingFriendRequestCount(
          friendRequestCount +
          recommendationRequestCount
        );
      } catch {
        /*
         * 친구 알림 조회 실패가
         * 지도 사용 자체를 막으면 안 되므로 조용히 무시합니다.
         */
      }
    }

    void loadFriendRequestCount();

    const handleFocus = () => {
      void loadFriendRequestCount();
    };

    window.addEventListener(
      "focus",
      handleFocus
    );

    const intervalId =
      window.setInterval(
        () => {
          void loadFriendRequestCount();
        },
        15_000
      );

    return () => {
      cancelled = true;

      window.removeEventListener(
        "focus",
        handleFocus
      );

      window.clearInterval(
        intervalId
      );
    };
  }, []);

  /* =======================================================
     1. 현재 위치 불러오기
  ======================================================= */

  useEffect(() => {
    const controller = new AbortController();
    async function initializeMap() {
      try {
        const [savedResponse, preferencesResponse] = await Promise.all([
          fetch("/api/saved-locations", { cache: "no-store", signal: controller.signal }),
          fetch("/api/preferences", { cache: "no-store", signal: controller.signal }),
        ]);
        if (savedResponse.status === 401 || preferencesResponse.status === 401) { router.replace("/login"); return; }
        if (!savedResponse.ok || !preferencesResponse.ok) throw new Error("계정 정보를 불러오지 못했습니다. 다시 시도해주세요.");
        const savedData = await savedResponse.json();
        const preferencesData = await preferencesResponse.json();
        if (controller.signal.aborted) return;
        if ((preferencesData.preferences ?? []).length < 3) { router.replace("/preferences"); return; }
        const saved: SavedLocation[] = savedData.locations ?? [];
        setSavedLocations(saved);
        localStorage.removeItem("jummechu_preferences");
        let initial: LocationData | null = null;
        try {
          const parsed = JSON.parse(localStorage.getItem("jummechu_location") ?? "null");
          const latitude = parseCoordinate(parsed?.latitude, "latitude");
          const longitude = parseCoordinate(parsed?.longitude, "longitude");
          if (latitude !== null && longitude !== null) initial = { latitude, longitude };
        } catch { /* An invalid browser value must not block account locations. */ }
        if (!initial && saved[0]) {
          initial = { latitude: saved[0].latitude, longitude: saved[0].longitude };
          localStorage.setItem("jummechu_location", JSON.stringify(initial));
        }
        if (!initial) { router.replace("/location"); return; }
        setLocation(initial);
        if (!clientId) setMapError("지도 설정이 필요합니다. 관리자에게 문의해주세요.");
      } catch (error) {
        if (!controller.signal.aborted) setMapError(error instanceof Error ? error.message : "지도를 준비하지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLocationLoaded(true);
      }
    }
    void initializeMap();
    return () => controller.abort();
  }, [router, clientId]);

  /*
   * 추천 가중치 / 개인설정 불러오기
   *
   * 우선 브라우저에 저장합니다.
   * 추후 계정 동기화 API를 추가해도 UI 구조는 그대로 사용할 수 있습니다.
   */
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          RECOMMENDATION_SETTINGS_KEY
        );

      if (raw) {
        const parsed =
          JSON.parse(
            raw
          ) as {
            preferenceWeight?: unknown;
            budgetEnabled?: unknown;
            budgetKrw?: unknown;
            includeUnknownPrice?: unknown;
            parkingRequired?: unknown;
            includeUnknownParking?: unknown;
            includeBars?: unknown;
          };

        if (
          typeof parsed.preferenceWeight ===
            "number" &&
          Number.isFinite(
            parsed.preferenceWeight
          )
        ) {
          setPreferenceWeight(
            Math.min(
              100,
              Math.max(
                0,
                Math.round(
                  parsed.preferenceWeight /
                  10
                ) *
                  10
              )
            )
          );
        }

        if (
          typeof parsed.budgetEnabled ===
          "boolean"
        ) {
          setBudgetEnabled(
            parsed.budgetEnabled
          );
        }

        if (
          typeof parsed.budgetKrw ===
            "number" &&
          Number.isFinite(
            parsed.budgetKrw
          )
        ) {
          setBudgetKrw(
            Math.min(
              500_000,
              Math.max(
                1_000,
                Math.round(
                  parsed.budgetKrw
                )
              )
            )
          );
        }

        if (
          typeof parsed.includeUnknownPrice ===
          "boolean"
        ) {
          setIncludeUnknownPrice(
            parsed.includeUnknownPrice
          );
        }

        if (
          typeof parsed.parkingRequired ===
          "boolean"
        ) {
          setParkingRequired(
            parsed.parkingRequired
          );
        }

        if (
          typeof parsed.includeUnknownParking ===
          "boolean"
        ) {
          setIncludeUnknownParking(
            parsed.includeUnknownParking
          );
        }

        if (
          typeof parsed.includeBars ===
          "boolean"
        ) {
          setIncludeBars(
            parsed.includeBars
          );
        }
      }
    } catch {
      /*
       * 잘못된 브라우저 저장값은 무시하고
       * 기본 설정으로 계속 사용합니다.
       */
    } finally {
      setRecommendationSettingsLoaded(
        true
      );
    }
  }, []);


  useEffect(() => {
    if (
      !recommendationSettingsLoaded
    ) {
      return;
    }

    localStorage.setItem(
      RECOMMENDATION_SETTINGS_KEY,
      JSON.stringify({
        preferenceWeight,
        budgetEnabled,
        budgetKrw,
        includeUnknownPrice,
        parkingRequired,
        includeUnknownParking,
        includeBars,
      })
    );
  }, [
    recommendationSettingsLoaded,
    preferenceWeight,
    budgetEnabled,
    budgetKrw,
    includeUnknownPrice,
    parkingRequired,
    includeUnknownParking,
    includeBars,
  ]);


  /* =======================================================
     2. NAVER MAP 인증 실패
  ======================================================= */

  useEffect(() => {
    window.navermap_authFailure =
      () => {
        setMapError(
          "NAVER 지도 인증에 실패했습니다."
        );
      };

    return () => {
      delete window.navermap_authFailure;
    };
  }, []);

  /* =======================================================
     3. 지도 생성
  ======================================================= */

  useEffect(() => {
    if (!mapLoaded) return;
    if (!location) return;
    if (!mapElementRef.current) return;
    if (!window.naver) return;

    const currentPosition =
      new window.naver.maps.LatLng(
        location.latitude,
        location.longitude
      );

    /*
     * 최초 1회
     */
    if (!mapInstanceRef.current) {
      const map =
        new window.naver.maps.Map(
          mapElementRef.current,
          {
            center:
              currentPosition,

            zoom: 16,
          }
        );

      mapInstanceRef.current =
        map;

      /*
       * 내 위치 마커
       */
      const myMarker =
        new window.naver.maps.Marker({
          position: currentPosition,
          map,

          zIndex: 10000,

          icon: {
            content: `
              <div
                style="
                  width:22px;
                  height:22px;

                  border-radius:50%;

                  background:#2563eb;

                  border:4px solid #ffffff;

                  box-shadow:
                    0 2px 8px
                    rgba(37,99,235,0.45);

                  box-sizing:border-box;
                "
              ></div>
            `,

            size:
              new window.naver.maps.Size(
                22,
                22
              ),

            anchor:
              new window.naver.maps.Point(
                11,
                11
              ),
          },
        });

      myMarkerRef.current =
        myMarker;

      return;
    }

    /*
     * 위치가 변경된 경우
     */
    mapInstanceRef.current.setCenter(
      currentPosition
    );

    myMarkerRef.current?.setPosition(
      currentPosition
    );
  }, [
    location,
    mapLoaded,
  ]);

  /* =======================================================
     음식점 수동 새로고침 쿨다운

     - 위치가 바뀌면 아래 음식점 API effect가 자동 재실행됩니다.
     - 같은 위치에서 수동 새로고침은 10초에 한 번만 허용합니다.
     - 서버에도 별도 rate limit이 있으므로 이 값은 UI 레벨의 1차 보호입니다.
  ======================================================= */

  useEffect(() => {
    if (restaurantRefreshCooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRestaurantRefreshCooldown(
        (current) => Math.max(0, current - 1)
      );
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [restaurantRefreshCooldown]);

  function refreshRestaurants() {
    if (
      restaurantLoading ||
      restaurantRefreshCooldown > 0
    ) {
      return;
    }

    setRestaurantRefreshCooldown(
      RESTAURANT_REFRESH_COOLDOWN_SECONDS
    );
    setRestaurantError("");
    setSelectedRestaurantId(null);
    setRestaurantRefreshKey(
      (current) => current + 1
    );
  }

  /* =======================================================
     4. 음식점 API
  ======================================================= */

  useEffect(() => {
    if (!location) return;

    const controller = new AbortController();
    async function loadRestaurants() {
      try {
        setRestaurantLoading(true);

        setRestaurantError("");
        setRestaurants([]);
        setSelectedRestaurantId(null);

        /*
         * query string
         */
        const params =
          new URLSearchParams({
            latitude: String(
              location!
                .latitude
            ),

            longitude: String(
              location!
                .longitude
            ),

            radiusKm: String(
              MAX_RESTAURANT_SEARCH_RADIUS_KM
            ),

          });

        /*
         * 서버 API
         */
        const response =
          await fetch(
            `/api/restaurants?${params.toString()}`,
            {
              signal: controller.signal,
              cache:
                "no-store",
            }
          );

        const data =
          (await response.json()) as RestaurantResponse;

        if (!response.ok) {
          throw new Error(
            data.message ??
              "음식점을 불러오지 못했습니다."
          );
        }

        if (controller.signal.aborted) return;
        setRestaurantError(data.message ?? "");
        setRestaurants(
          (data.restaurants ?? []).map(
            normalizeRestaurant
          )
        );

        setRegionName(
          data.region
            ?.displayName ??""
        );

        setRecommendationMode(
          data.recommendationMode ??
            "category"
        );

        setRecommendedMenus(
          data.recommendedMenus ??
            []
        );

        setSearchMenus(
          data.searchMenus ??
            []
        );

        /*
         * 새 검색 시 선택 초기화
         */
        setSelectedRestaurantId(
          null
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);

        if (
          error instanceof Error
        ) {
          setRestaurantError(
            error.message
          );
        } else {
          setRestaurantError(
            "음식점을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!controller.signal.aborted) setRestaurantLoading(
          false
        );
      }
    }

    loadRestaurants();
    return () => controller.abort();
  }, [
    location?.latitude,
    location?.longitude,
    restaurantRefreshKey,
  ]);

  /* =======================================================
     5. 개인설정 필터 + 사용자 가중치 정렬
  ======================================================= */

  const sortedRestaurants =
    useMemo(() => {
      const result =
        restaurants.filter(
          (restaurant) => {
            if (
              !restaurant.recommendationEligible
            ) {
              return false;
            }

            /*
             * 술집은 기본 추천에서 제외.
             */
            if (
              restaurant.venueType ===
                "bar" &&
              !includeBars
            ) {
              return false;
            }

            /*
             * 예산 필터
             */
            if (
              budgetEnabled
            ) {
              if (
                restaurant.priceKrw ===
                  null ||
                restaurant.priceSource ===
                  "unknown"
              ) {
                if (
                  !includeUnknownPrice
                ) {
                  return false;
                }
              } else if (
                restaurant.priceKrw >
                budgetKrw
              ) {
                return false;
              }
            }

            /*
             * 주차 필터
             *
             * true  -> 주차 가능
             * false -> 주차 불가
             * null/undefined -> 미확인
             */
            if (
              parkingRequired
            ) {
              if (
                restaurant.parkingAvailable ===
                false
              ) {
                return false;
              }

              if (
                restaurant.parkingAvailable !==
                  true &&
                !includeUnknownParking
              ) {
                return false;
              }
            }

            return true;
          }
        );

      result.sort(
        (a, b) => {
          /*
           * 식사 목적 음식점을 먼저,
           * 술집은 뒤에 별도 구역으로 배치합니다.
           */
          if (
            a.venueType !==
            b.venueType
          ) {
            return a.venueType ===
              "bar"
              ? 1
              : -1;
          }

          return (
            calculateWeightedRecommendScore(
              b,
              preferenceWeight
            )
            -
            calculateWeightedRecommendScore(
              a,
              preferenceWeight
            )
          );
        }
      );

      return result;
    }, [
      restaurants,
      preferenceWeight,
      budgetEnabled,
      budgetKrw,
      includeUnknownPrice,
      parkingRequired,
      includeUnknownParking,
      includeBars,
    ]);

  const mealRestaurantCount =
    useMemo(
      () =>
        sortedRestaurants.filter(
          (restaurant) =>
            restaurant.venueType !==
            "bar"
        ).length,
      [
        sortedRestaurants,
      ]
    );

  const barRestaurantCount =
    useMemo(
      () =>
        sortedRestaurants.filter(
          (restaurant) =>
            restaurant.venueType ===
            "bar"
        ).length,
      [
        sortedRestaurants,
      ]
    );


  const closedRestaurants =
    useMemo(
      () =>
        restaurants
          .filter(
            (restaurant) =>
              !restaurant.recommendationEligible &&
              restaurant.businessHours.status !==
                "UNKNOWN" &&
              (
                includeBars ||
                restaurant.venueType !==
                  "bar"
              )
          )
          .sort(
            (a, b) =>
              a.distance -
              b.distance
          ),
      [
        restaurants,
        includeBars,
      ]
    );

  /* =======================================================
     선택된 음식점
  ======================================================= */

  const selectedRestaurant =
    useMemo(() => {
      if (
        !selectedRestaurantId
      ) {
        return null;
      }

      return (
        sortedRestaurants.find(
          (restaurant) =>
            restaurant.id ===
            selectedRestaurantId
        ) ?? null
      );
    }, [
      sortedRestaurants,
      selectedRestaurantId,
    ]);

  /* =======================================================
     현재 MASK 점수
  ======================================================= */

  const getRestaurantScore =
    useCallback(
      (
        restaurant: Restaurant
      ) =>
        calculateWeightedRecommendScore(
          restaurant,
          preferenceWeight
        ),
      [
        preferenceWeight,
      ]
    );

  /* =======================================================
     음식점 선택
  ======================================================= */

  function selectRestaurant(
    restaurant: Restaurant
  ) {
    // 음식점을 선택해도 지도 위치는 움직이지 않습니다.
    // 사용자가 보고 있던 지도 범위를 그대로 유지합니다.
    setSelectedRestaurantId(
      restaurant.id
    );
  }

  /* =======================================================
     6. 음식점 마커 생성
  ======================================================= */

  useEffect(() => {
    if (!mapLoaded) return;
    if (!window.naver) return;

    if (
      !mapInstanceRef.current
    ) {
      return;
    }

    /*
     * 기존 listener 제거
     */
    markerListenersRef.current.forEach(
      (listener) => {
        window.naver?.maps.Event.removeListener(
          listener
        );
      }
    );

    markerListenersRef.current =
      [];

    /*
     * 기존 마커 제거
     */
    restaurantMarkersRef.current.forEach(
      (marker) => {
        marker.setMap(null);
      }
    );

    restaurantMarkersRef.current =
      [];

    /*
     * 새 마커 생성
     */
    sortedRestaurants.forEach(
      (restaurant) => {
        const score =
          getRestaurantScore(
            restaurant
          );

        const selected =
          restaurant.id ===
          selectedRestaurantId;

        /*
         * 선택된 음식점은 더 크게
         */
        const normalSize =
          score >= 80
            ? 50
            : score >= 60
              ? 44
              : 38;

        const markerSize =
          selected
            ? normalSize + 10
            : normalSize;

        const position =
          new window.naver!.maps.LatLng(
            restaurant.latitude,
            restaurant.longitude
          );

        const safeName =
          escapeHtmlAttribute(
            restaurant.name
          );

        /*
         * 선택 여부에 따라 스타일 변경
         */
        const background =
          selected
            ? "#ea580c"
            : "#f97316";

        const border =
          selected
            ? "5px solid #fff"
            : "4px solid #fff";

        const marker =
          new window.naver!.maps.Marker(
            {
              position,

              map:
                mapInstanceRef.current!,

              zIndex:
                selected
                  ? 9999
                  : score,

              icon: {
                content: `
                  <div
                    title="${safeName}"

                    style="
                      width:${markerSize}px;
                      height:${markerSize}px;

                      box-sizing:border-box;

                      border-radius:50%;

                      background:${background};

                      border:${border};

                      box-shadow:${
                        selected
                          ? "0 5px 18px rgba(234,88,12,0.55)"
                          : "0 4px 12px rgba(0,0,0,0.25)"
                      };

                      display:flex;

                      align-items:center;

                      justify-content:center;

                      color:#ffffff;

                      font-size:${
                        selected
                          ? 13
                          : 12
                      }px;

                      font-weight:800;

                      cursor:pointer;

                      user-select:none;

                      white-space:nowrap;

                      transition:
                        all .2s ease;
                    "
                  >
                    ${score}
                  </div>
                `,

                size:
                  new window.naver!.maps.Size(
                    markerSize,
                    markerSize
                  ),

                anchor:
                  new window.naver!.maps.Point(
                    markerSize /
                      2,

                    markerSize /
                      2
                  ),
              },
            }
          );

        /*
         * 마커 클릭
         */
        const listener =
          window.naver!.maps.Event.addListener(
            marker,
            "click",
            () => {
              /*
               * 선택
               */
              setSelectedRestaurantId(
                restaurant.id
              );

              /*
               * 해당 카드로 스크롤
               */
              setTimeout(
                () => {
                  restaurantCardRefs.current[
                    restaurant.id
                  ]?.scrollIntoView(
                    {
                      behavior:
                        "smooth",

                      block:
                        "center",
                    }
                  );
                },
                50
              );
            }
          );

        restaurantMarkersRef.current.push(
          marker
        );

        markerListenersRef.current.push(
          listener
        );
      }
    );

    return () => {
      markerListenersRef.current.forEach(
        (listener) => {
          window.naver?.maps.Event.removeListener(
            listener
          );
        }
      );

      markerListenersRef.current =
        [];

      restaurantMarkersRef.current.forEach(
        (marker) => {
          marker.setMap(null);
        }
      );

      restaurantMarkersRef.current =
        [];
    };
  }, [
    sortedRestaurants,
    getRestaurantScore,
    mapLoaded,
    mode,
    selectedRestaurantId,
  ]);

  /* =======================================================
     7. 내 위치 + 음식점 전체 자동 줌
  ======================================================= */

  useEffect(() => {
    if (!mapLoaded) return;
    if (!window.naver) return;

    if (
      !mapInstanceRef.current
    ) {
      return;
    }

    if (!location) return;

    if (
      sortedRestaurants.length ===
      0
    ) {
      return;
    }

    /*
     * 현재 위치
     */
    const myPosition =
      new window.naver.maps.LatLng(
        location.latitude,
        location.longitude
      );

    /*
     * bounds
     */
    const bounds =
      new window.naver.maps.LatLngBounds(
        myPosition,
        myPosition
      );

    sortedRestaurants.forEach(
      (restaurant) => {
        const position =
          new window.naver!.maps.LatLng(
            restaurant.latitude,
            restaurant.longitude
          );

        bounds.extend(
          position
        );
      }
    );

    mapInstanceRef.current.fitBounds(
      bounds
    );
  }, [
    sortedRestaurants,
    location,
    mapLoaded,
  ]);

  /* =======================================================
     8. 검색 기준 위치 이동 / 저장
  ======================================================= */

  function useMapCenterAsLocation() {
    if (!mapInstanceRef.current) return;

    const center =
      mapInstanceRef.current.getCenter();

    const newLocation = {
      latitude: center.lat(),
      longitude: center.lng(),
    };

    localStorage.setItem(
      "jummechu_location",
      JSON.stringify({
        ...newLocation,
        source: "map-center",
      })
    );

    setLocation(newLocation);

    setSelectedRestaurantId(null);
  }
  async function saveCurrentMapLocation() {
    if (!location) return;

    const name =
      saveLocationName.trim();

    if (!name) return;

    try {
      const response =
        await fetch(
          "/api/saved-locations",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name,

                latitude:
                  location.latitude,

                longitude:
                  location.longitude,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "위치 저장에 실패했습니다."
        );
      }

      /*
      * DB에서 생성된 id를 포함한
      * 실제 데이터를 state에 추가
      */
      setSavedLocations(
        (current) => [
          ...current,
          data.location,
        ]
      );

      setSaveLocationName(
        ""
      );

      setShowSaveLocation(
        false
      );
    } catch (error) {
      console.error(
        "위치 저장 오류:",
        error
      );
      alert(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    }
  }

  function openLocationManage(
    saved: SavedLocation
  ) {
    setEditingLocation(saved);
    setEditingLocationName(saved.name);
    setShowLocationManage(true);
  }

  function closeLocationManage() {
    setShowLocationManage(false);
    setEditingLocation(null);
    setEditingLocationName("");
  }

  async function renameSavedLocation() {
    if (!editingLocation) {
      return;
    }

    const newName =
      editingLocationName.trim();

    if (!newName) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/saved-locations/${editingLocation.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                name:
                  newName,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "이름 변경에 실패했습니다."
        );
      }

      setSavedLocations(
        (current) =>
          current.map(
            (saved) =>
              saved.id ===
              editingLocation.id
                ? data.location
                : saved
          )
      );

      setShowLocationManage(
        false
      );

      setEditingLocation(
        null
      );

      setEditingLocationName(
        ""
      );
    } catch (error) {
      console.error(
        "위치 이름 변경 오류:",
        error
      );
      alert(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    }
  }

  async function deleteSavedLocation() {
    if (!editingLocation) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/saved-locations/${editingLocation.id}`,
          {
            method:
              "DELETE",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "저장 위치 삭제에 실패했습니다."
        );
      }

      setSavedLocations(
        (current) =>
          current.filter(
            (saved) =>
              saved.id !==
              editingLocation.id
          )
      );

      setShowLocationManage(
        false
      );

      setEditingLocation(
        null
      );

      setEditingLocationName(
        ""
      );
    } catch (error) {
      console.error(
        "위치 삭제 오류:",
        error
      );
      alert(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    }
  }

  function moveToSavedLocation(
    saved: SavedLocation
  ) {

    const newLocation = {
      latitude: saved.latitude,
      longitude: saved.longitude,
    };

    localStorage.setItem(
      "jummechu_location",
      JSON.stringify({
        ...newLocation,
        source: "favorite",
        name: saved.name,
      })
    );

    setLocation(newLocation);
    setMapError("");
    if (!window.naver || !mapInstanceRef.current) return;

    const position =
      new window.naver.maps.LatLng(
        saved.latitude,
        saved.longitude
      );

    mapInstanceRef.current.setCenter(
      position
    );

    mapInstanceRef.current.setZoom(17);

    setSelectedRestaurantId(null);
  }

  
  function moveToSearchLocation() {
    if (
      !location ||
      !window.naver ||
      !mapInstanceRef.current
    ) {
      return;
    }

    const position =
      new window.naver.maps.LatLng(
        location.latitude,
        location.longitude
      );

    setSelectedRestaurantId(
      null
    );

    mapInstanceRef.current.setCenter(
      position
    );

    mapInstanceRef.current.setZoom(
      16
    );
  }

  /* =========================================================
   장소 검색
  ========================================================= */

  async function searchLocation(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (locationSearchLoading) return;
    const query =
      locationSearchQuery.trim();

    if (!query) {
      setLocationSearchError(
        "검색할 장소를 입력해주세요."
      );

      return;
    }

    try {
      setLocationSearchLoading(true);
      setLocationSearchError("");
      setLocationSearchResults([]);

      const params =
        new URLSearchParams({
          query,
        });

      /*
      * 현재 파란 기준 위치가 있다면
      * 가까운 장소부터 검색
      */
      if (location) {
        params.set(
          "latitude",
          String(location.latitude)
        );

        params.set(
          "longitude",
          String(location.longitude)
        );
      }

      const response =
        await fetch(
          `/api/location-search?${params.toString()}`,
          {
            cache: "no-store",
          }
        );

      const data =
        (await response.json()) as LocationSearchResponse;

      if (!response.ok) {
        throw new Error(
          data.message ??
            "장소 검색에 실패했습니다."
        );
      }

      const results =
        data.results ?? [];

      if (results.length === 0) {
        setLocationSearchError(
          `"${query}" 검색 결과가 없습니다.`
        );

        return;
      }

      setLocationSearchResults(
        results
      );
    } catch (error) {
      console.error(
        "LOCATION SEARCH ERROR:",
        error
      );

      if (error instanceof Error) {
        setLocationSearchError(
          error.message
        );
      } else {
        setLocationSearchError(
          "장소 검색 중 문제가 발생했습니다."
        );
      }
    } finally {
      setLocationSearchLoading(false);
    }
  }

  /* =========================================================
    검색 결과 선택
  ========================================================= */

  function selectSearchedLocation(
    result: LocationSearchResult
  ) {
    const newLocation = {
      latitude: result.latitude,
      longitude: result.longitude,
    };

    /*
    * 현재 검색 기준 위치 저장
    */
    localStorage.setItem(
      "jummechu_location",
      JSON.stringify({
        ...newLocation,

        source: "place-search",

        name: result.name,

        address:
          result.roadAddress ||
          result.jibunAddress,
      })
    );

    /*
    * 파란 기준점 변경
    *
    * location이 바뀌면
    * 기존 음식점 API effect도 다시 실행됨
    */
    setLocation(
      newLocation
    );
    setMapError("");

    setSelectedRestaurantId(
      null
    );

    /*
    * 지도 이동
    */
    if (
      window.naver &&
      mapInstanceRef.current
    ) {
      const position =
        new window.naver.maps.LatLng(
          result.latitude,
          result.longitude
        );

      mapInstanceRef.current.setCenter(
        position
      );

      mapInstanceRef.current.setZoom(
        17
      );
    }

    /*
    * 검색 UI 정리
    */
    setLocationSearchQuery(
      result.name
    );

    setLocationSearchResults(
      []
    );

    setLocationSearchError(
      ""
    );
  }
  /* =======================================================
     거리 표시
  ======================================================= */
  function getNaverMapLink(
    restaurant: Restaurant
  ) {
    return `https://map.naver.com/p/search/${encodeURIComponent(
      restaurant.name
    )}`;
  }
  function formatDistance(
    distance: number
  ) {
    if (distance < 1000) {
      return `${distance}m`;
    }

    return `${(
      distance / 1000
    ).toFixed(1)}km`;
  }
  function getMatchedRecommendedMenus(
    restaurant: Restaurant
  ) {
    return restaurant
      .matchedPreferences
      .map((name) =>
        recommendedMenus.find(
          (menu) =>
            menu.name === name
        )
      )
      .filter(
        (
          menu
        ): menu is RecommendedMenu =>
          Boolean(menu)
      );
  }


  function getRecommendationReason(
    restaurant: Restaurant
  ) {
    if (
      recommendationMode !==
      "embedding"
    ) {
      return null;
    }

    const matched =
      getMatchedRecommendedMenus(
        restaurant
      );

    if (
      matched.length === 0
    ) {
      return null;
    }

    const best = [...matched].sort(
      (a, b) =>
        b.score - a.score
    )[0];

    if (best.anchor) {
      return (
        `${best.anchor} 취향과 비슷한 ` +
        `${best.name} 메뉴로 추천했어요`
      );
    }

    return (
      `${best.name} 메뉴 취향과 ` +
      `잘 맞는 곳이에요`
    );
  }

  const BUSINESS_DAY_NAMES = [
    "일",
    "월",
    "화",
    "수",
    "목",
    "금",
    "토",
  ];

  function getKoreaDayOfWeek() {
    const weekday =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            "Asia/Seoul",

          weekday:
            "short",
        }
      ).format(
        new Date()
      );

    const dayMap:
      Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };

    return dayMap[
      weekday
    ] ?? 0;
  }

  function openBusinessHoursEditor(
    restaurant: Restaurant
  ) {
    const hours =
      restaurant.businessHours;

    setBusinessHoursRestaurant(
      restaurant
    );

    setBusinessHoursDay(
      getKoreaDayOfWeek()
    );

    setBusinessHoursOpen(
      hours.todayOpen ??
        "11:00"
    );

    setBusinessHoursClose(
      hours.todayClose ??
        "21:00"
    );

    setBusinessHoursBreakStart(
      hours.breakStart ?? ""
    );

    setBusinessHoursBreakEnd(
      hours.breakEnd ?? ""
    );

    setBusinessHoursClosed(
      hours.status ===
        "CLOSED_TODAY"
    );

    setBusinessHoursApplyAllDays(
      false
    );

    setBusinessHoursError(
      ""
    );

    setShowBusinessHoursModal(
      true
    );
  }

  function closeBusinessHoursEditor() {
    if (
      businessHoursSaving
    ) {
      return;
    }

    setShowBusinessHoursModal(
      false
    );

    setBusinessHoursRestaurant(
      null
    );

    setBusinessHoursError(
      ""
    );
  }

  async function saveBusinessHours() {
    if (
      !businessHoursRestaurant ||
      businessHoursSaving
    ) {
      return;
    }

    if (
      !businessHoursClosed &&
      (
        !businessHoursOpen ||
        !businessHoursClose
      )
    ) {
      setBusinessHoursError(
        "영업 시작/종료 시간을 입력해주세요."
      );

      return;
    }

    if (
      Boolean(
        businessHoursBreakStart
      ) !==
      Boolean(
        businessHoursBreakEnd
      )
    ) {
      setBusinessHoursError(
        "브레이크타임 시작/종료 시간을 모두 입력해주세요."
      );

      return;
    }

    try {
      setBusinessHoursSaving(
        true
      );

      setBusinessHoursError(
        ""
      );

      const response =
        await fetch(
          "/api/business-hours",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                restaurantKey:
                  businessHoursRestaurant.id,

                restaurantName:
                  businessHoursRestaurant.name,

                roadAddress:
                  businessHoursRestaurant
                    .roadAddress ||
                  businessHoursRestaurant
                    .address,

                dayOfWeek:
                  businessHoursDay,

                openTime:
                  businessHoursClosed
                    ? null
                    : businessHoursOpen,

                closeTime:
                  businessHoursClosed
                    ? null
                    : businessHoursClose,

                breakStartTime:
                  businessHoursClosed ||
                  !businessHoursBreakStart
                    ? null
                    : businessHoursBreakStart,

                breakEndTime:
                  businessHoursClosed ||
                  !businessHoursBreakEnd
                    ? null
                    : businessHoursBreakEnd,

                isClosed:
                  businessHoursClosed,

                applyAllDays:
                  businessHoursApplyAllDays,

                sourceUrl:
                  getNaverMapLink(
                    businessHoursRestaurant
                  ),
              }),
          }
        );

      const data =
        await response.json();

      if (
        response.status ===
        401
      ) {
        router.replace(
          "/login"
        );

        return;
      }

      if (
        !response.ok
      ) {
        throw new Error(
          data.message ??
            "영업시간 저장에 실패했습니다."
        );
      }

      setShowBusinessHoursModal(
        false
      );

      setBusinessHoursRestaurant(
        null
      );

      setRestaurantRefreshKey(
        (current) =>
          current + 1
      );

    } catch (error) {
      setBusinessHoursError(
        error instanceof Error
          ? error.message
          : "영업시간 저장에 실패했습니다."
      );

    } finally {
      setBusinessHoursSaving(
        false
      );
    }
  }


  function openPriceReportEditor(
    restaurant: Restaurant
  ) {
    setPriceReportRestaurant(
      restaurant
    );

    setPriceReportMenu(
      restaurant.priceMenuName ||
        restaurant.recommendedMenuName ||
        ""
    );

    setPriceReportPrice(
      ""
    );

    setPriceReportNote(
      ""
    );

    setPriceReportError(
      ""
    );

    setPriceReportSuccess(
      ""
    );

    setShowPriceReportModal(
      true
    );
  }


  function closePriceReportEditor() {
    if (
      priceReportSaving
    ) {
      return;
    }

    setShowPriceReportModal(
      false
    );

    setPriceReportRestaurant(
      null
    );

    setPriceReportMenu(
      ""
    );

    setPriceReportPrice(
      ""
    );

    setPriceReportNote(
      ""
    );

    setPriceReportError(
      ""
    );

    setPriceReportSuccess(
      ""
    );
  }


  async function submitPriceReport() {
    if (
      !priceReportRestaurant ||
      priceReportSaving
    ) {
      return;
    }

    const menuName =
      priceReportMenu
        .trim();

    if (
      !menuName
    ) {
      setPriceReportError(
        "메뉴 이름을 입력해주세요."
      );

      return;
    }

    const reportedPriceKrw =
      Number(
        priceReportPrice
      );

    if (
      !Number.isInteger(
        reportedPriceKrw
      ) ||
      reportedPriceKrw <
        100 ||
      reportedPriceKrw >
        10_000_000
    ) {
      setPriceReportError(
        "가격은 100원 이상 10,000,000원 이하의 정수로 입력해주세요."
      );

      return;
    }

    const currentPriceMenu =
      priceReportRestaurant
        .priceMenuName
        ?.trim() ||
      priceReportRestaurant
        .recommendedMenuName
        ?.trim() ||
      "";

    const reportingCurrentMenu =
      currentPriceMenu.length >
        0 &&
      menuName ===
        currentPriceMenu;

    try {
      setPriceReportSaving(
        true
      );

      setPriceReportError(
        ""
      );

      setPriceReportSuccess(
        ""
      );

      const response =
        await fetch(
          "/api/price-reports",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                restaurantMenuPriceId:
                  reportingCurrentMenu
                    ? priceReportRestaurant
                        .restaurantMenuPriceId
                    : null,

                restaurantName:
                  priceReportRestaurant
                    .name,

                restaurantAddress:
                  priceReportRestaurant
                    .roadAddress ||
                  priceReportRestaurant
                    .address,

                menuName,

                reportedPriceKrw,

                previousPriceKrw:
                  reportingCurrentMenu
                    ? priceReportRestaurant
                        .directPriceKrw
                    : null,

                note:
                  priceReportNote
                    .trim() ||
                  null,
              }),
          }
        );

      const data =
        (await response.json()) as {
          message?: string;
        };

      if (
        response.status ===
        401
      ) {
        router.replace(
          "/login"
        );

        return;
      }

      if (
        !response.ok
      ) {
        throw new Error(
          data.message ??
            "가격 제보를 저장하지 못했습니다."
        );
      }

      setPriceReportSuccess(
        data.message ??
          "가격 제보가 접수되었습니다. 관리자 검토 후 반영됩니다."
      );

      setPriceReportPrice(
        ""
      );

      setPriceReportNote(
        ""
      );

    } catch (
      error
    ) {
      setPriceReportError(
        error instanceof
          Error
          ? error.message
          : "가격 제보를 저장하지 못했습니다."
      );

    } finally {
      setPriceReportSaving(
        false
      );
    }
  }


  function formatPriceKrw(
    price:
      number | null
  ) {

    if (
      price === null
    ) {
      return "가격 정보 없음";
    }


    return `${price.toLocaleString("ko-KR")}원`;
  }


  function getRecommendedMenuLabel(
    restaurant: Restaurant
  ) {

    return (
      restaurant
        .recommendedMenuName ??
      restaurant
        .matchedPreferences[0] ??
      "추천 메뉴 준비 중"
    );
  }


  function getPriceSummary(
    restaurant: Restaurant
  ) {

    if (
      restaurant.priceSource ===
        "direct" &&
      restaurant.priceKrw !==
        null
    ) {

      return {
        text:
          formatPriceKrw(
            restaurant.priceKrw
          ),

        subtext:
          "추천 메뉴의 확인된 가격",
      };
    }


    if (
      restaurant.priceSource ===
        "regional" &&
      restaurant.priceKrw !==
        null
    ) {

      return {
        text:
          `약 ${formatPriceKrw(
            restaurant.priceKrw
          )}`,

        subtext:
          "추천 메뉴의 지역 평균 기준",
      };
    }


    return {
      text:
        "가격 정보 없음",

      subtext:
        "가격 제보가 아직 없어요",
    };
  }


  function getBusinessStatusClasses(
    restaurant: Restaurant
  ) {
    switch (
      restaurant.businessHours.status
    ) {
      case "OPEN":
        return {
          dot: "bg-emerald-500",
          text: "text-emerald-600",
          box: "bg-emerald-50 border-emerald-100",
        };

      case "BREAK":
        return {
          dot: "bg-amber-500",
          text: "text-amber-600",
          box: "bg-amber-50 border-amber-100",
        };

      case "CLOSED":
      case "CLOSED_TODAY":
        return {
          dot: "bg-red-500",
          text: "text-red-600",
          box: "bg-red-50 border-red-100",
        };

      default:
        return {
          dot: "bg-gray-400",
          text: "text-gray-500",
          box: "bg-gray-50 border-gray-100",
        };
    }
  }

  function renderBusinessStatus(
    restaurant: Restaurant,
    compact = false
  ) {
    const styles =
      getBusinessStatusClasses(
        restaurant
      );

    const hours =
      restaurant.businessHours;

    return (
      <div
        className={`inline-flex ${
          compact
            ? "items-center gap-1.5"
            : "items-start gap-2 rounded-xl border px-3 py-2"
        } ${compact ? "" : styles.box}`}
      >
        <span
          className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${styles.dot}`}
        />

        <div className="min-w-0">
          <p
            className={`text-xs font-bold ${styles.text}`}
          >
            {hours.label}
          </p>

          {!compact &&
            hours.detail && (
              <p className="mt-0.5 text-[11px] text-gray-500">
                {hours.detail}
              </p>
            )}

          {!compact &&
            hours.nextOpenText && (
              <p className="mt-0.5 text-[11px] font-semibold text-gray-500">
                {hours.nextOpenText}
              </p>
            )}
        </div>
      </div>
    );
  }

  /* =======================================================
     MASK 설명
  ======================================================= */

  const description = (() => {
    if (
      mode ===
      "settings"
    ) {
      return "개인 설정은 추천 점수에 섞지 않고 조건 필터로 적용해요.";
    }

    return `메뉴 취향 ${preferenceWeight}% · 거리 ${distanceWeight}%로 추천해요.`;
  })();

  /* =======================================================
     JSX
  ======================================================= */

  return (
    <>
      {/* NAVER SDK */}

      {clientId && (
        <Script
          id="naver-maps-sdk"
          src={`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`}
          strategy="afterInteractive"

          onLoad={() => {
            console.log("NAVER Maps SDK onLoad");

            if (window.naver?.maps) {
              setMapLoaded(true);
            }
          }}

          onReady={() => {
            console.log("NAVER Maps SDK onReady");

            if (window.naver?.maps) {
              setMapLoaded(true);
            }
          }}

          onError={() => {
            setMapError(
              "NAVER 지도 스크립트를 불러오지 못했습니다."
            );
          }}
        />
      )}

      <main className="min-h-screen bg-[#f8f7f3]">

        <div className="mx-auto flex min-h-screen max-w-md flex-col bg-white shadow-sm">

          {/* =================================================
              HEADER
          ================================================= */}

          <header className="grid grid-cols-[72px_1fr_72px] items-center border-b border-gray-100 px-5 py-4">

            <button
              type="button"
              onClick={() =>
                window.history.back()
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
              aria-label="뒤로가기"
            >
              ←
            </button>

            <h1 className="text-center text-lg font-bold text-gray-900">
              점메추
            </h1>

            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/friends"
                  )
                }
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg text-gray-500 transition hover:bg-orange-50 hover:text-orange-500"
                aria-label={
                  incomingFriendRequestCount > 0
                    ? `친구 알림 ${incomingFriendRequestCount}개`
                    : "친구"
                }
                title="친구"
              >
                👥

                {incomingFriendRequestCount > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-none text-white shadow-sm ring-2 ring-white"
                    aria-hidden="true"
                  >
                    {incomingFriendRequestCount > 99
                      ? "99+"
                      : incomingFriendRequestCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/mypage"
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-gray-500 transition hover:bg-gray-100"
                aria-label="마이페이지"
                title="마이페이지"
              >
                👤
              </button>
            </div>

          </header>
          <section className="border-b border-gray-100 px-4 py-3" aria-label="지도에서 장소 검색">
            <form onSubmit={searchLocation} className="flex gap-2">
              <input aria-label="장소 검색" value={locationSearchQuery} onChange={(event) => setLocationSearchQuery(event.target.value)}
                placeholder="어디에서 먹을까요? 장소를 검색해요" maxLength={200}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              <button type="submit" disabled={locationSearchLoading || !locationSearchQuery.trim()}
                className="rounded-xl bg-orange-500 px-4 text-sm font-bold text-white disabled:opacity-40">{locationSearchLoading ? "검색 중" : "검색"}</button>
            </form>
            {locationSearchError && <p role="alert" className="mt-2 text-xs text-red-500">{locationSearchError}</p>}
            {locationSearchResults.length > 0 && <ul className="mt-2 max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-100">
              {locationSearchResults.map((result) => <li key={result.id}>
                <button type="button" onClick={() => selectSearchedLocation(result)} className="w-full p-3 text-left hover:bg-orange-50">
                  <span className="block text-sm font-bold text-gray-800">{result.name}</span>
                  <span className="mt-1 block text-xs text-gray-500">{result.roadAddress || result.jibunAddress}</span>
                  <span className="mt-1 block text-xs text-orange-500">{result.category}{result.distance !== null ? " · " + formatDistance(result.distance) : ""}</span>
                </button>
              </li>)}
            </ul>}
          </section>

          {/* =================================================
              추천 / 개인설정
          ================================================= */}

          <div className="border-b border-gray-100 px-4 py-3">

            <div className="flex rounded-2xl bg-gray-100 p-1">

              <button
                type="button"
                onClick={() =>
                  setMode(
                    "recommend"
                  )
                }
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                  mode ===
                  "recommend"
                    ? "bg-white text-orange-500 shadow-sm"
                    : "text-gray-500"
                }`}
              >
                추천
              </button>

              <button
                type="button"
                onClick={() =>
                  setMode(
                    "settings"
                  )
                }
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                  mode ===
                  "settings"
                    ? "bg-white text-orange-500 shadow-sm"
                    : "text-gray-500"
                }`}
              >
                개인설정
              </button>

            </div>


            {mode ===
              "recommend" && (
              <div className="mt-3 rounded-2xl border border-orange-100 bg-orange-50/60 p-4">

                <div className="flex items-start justify-between gap-3">

                  <div>

                    <p className="text-xs font-bold text-gray-800">
                      추천 기준
                    </p>

                    <p className="mt-1 text-[11px] leading-4 text-gray-500">
                      메뉴 취향과 거리의 비중을 직접 조절해요.
                    </p>

                  </div>


                  <div className="shrink-0 rounded-full bg-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                    취향 {preferenceWeight}% · 거리 {distanceWeight}%
                  </div>

                </div>


                <div className="mt-4">

                  <div className="flex items-center justify-between text-[11px] font-bold">

                    <span className="text-orange-600">
                      🍽 메뉴 취향
                    </span>

                    <span className="text-blue-600">
                      📍 거리
                    </span>

                  </div>


                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={10}
                    value={
                      preferenceWeight
                    }
                    onChange={(event) => {
                      setPreferenceWeight(
                        Number(
                          event.target.value
                        )
                      );

                      setSelectedRestaurantId(
                        null
                      );
                    }}
                    aria-label="메뉴 취향 추천 가중치"
                    className="mt-2 w-full cursor-pointer accent-orange-500"
                  />


                  <div className="mt-3 grid grid-cols-4 gap-2">

                    {[
                      {
                        value: 30,
                        label: "거리 우선",
                      },
                      {
                        value: 50,
                        label: "균형",
                      },
                      {
                        value: 70,
                        label: "취향 우선",
                      },
                      {
                        value: 90,
                        label: "취향 최우선",
                      },
                    ].map(
                      (
                        preset
                      ) => (
                        <button
                          key={
                            preset.value
                          }
                          type="button"
                          onClick={() => {
                            setPreferenceWeight(
                              preset.value
                            );

                            setSelectedRestaurantId(
                              null
                            );
                          }}
                          className={`rounded-xl px-1 py-2 text-[10px] font-bold transition ${
                            preferenceWeight ===
                            preset.value
                              ? "bg-orange-500 text-white"
                              : "bg-white text-gray-500 shadow-sm"
                          }`}
                        >
                          {
                            preset.label
                          }
                        </button>
                      )
                    )}

                  </div>

                </div>


                {(budgetEnabled ||
                  parkingRequired ||
                  includeBars) && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-orange-100 pt-3">

                    <span className="text-[10px] font-bold text-gray-400">
                      적용 중
                    </span>

                    {budgetEnabled && (
                      <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-600 shadow-sm">
                        💰 {budgetKrw.toLocaleString("ko-KR")}원 이하
                      </span>
                    )}

                    {parkingRequired && (
                      <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-blue-600 shadow-sm">
                        🅿 주차 가능
                      </span>
                    )}

                    {includeBars && (
                      <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-violet-600 shadow-sm">
                        🍺 술집 포함
                      </span>
                    )}

                  </div>
                )}

              </div>
            )}


            {mode ===
              "settings" && (
              <div className="mt-3 space-y-3">

                {/* 예산 */}
                <section className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">

                  <label className="flex cursor-pointer items-start justify-between gap-3">

                    <div>

                      <p className="text-xs font-bold text-gray-800">
                        💰 1인 예산
                      </p>

                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        켜면 예산을 초과한 식당을 추천에서 제외해요.
                      </p>

                    </div>

                    <input
                      type="checkbox"
                      checked={
                        budgetEnabled
                      }
                      onChange={(event) => {
                        setBudgetEnabled(
                          event.target.checked
                        );

                        setSelectedRestaurantId(
                          null
                        );
                      }}
                      className="mt-0.5 h-5 w-5 accent-emerald-500"
                    />

                  </label>


                  {budgetEnabled && (
                    <>

                      <div className="mt-4 grid grid-cols-4 gap-2">

                        {[10_000, 15_000, 20_000, 30_000].map(
                          (
                            preset
                          ) => (
                            <button
                              key={
                                preset
                              }
                              type="button"
                              onClick={() => {
                                setBudgetKrw(
                                  preset
                                );

                                setSelectedRestaurantId(
                                  null
                                );
                              }}
                              className={`rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                                budgetKrw ===
                                preset
                                  ? "bg-emerald-500 text-white"
                                  : "bg-white text-gray-600 shadow-sm"
                              }`}
                            >
                              {(
                                preset /
                                10_000
                              ).toLocaleString(
                                "ko-KR"
                              )}만원
                            </button>
                          )
                        )}

                      </div>


                      <label className="mt-3 block">

                        <span className="text-[11px] font-semibold text-gray-500">
                          직접 입력
                        </span>

                        <div className="mt-1 flex items-center rounded-xl border border-emerald-100 bg-white px-3">

                          <input
                            type="number"
                            min={1_000}
                            max={500_000}
                            step={1_000}
                            value={
                              budgetKrw
                            }
                            onChange={(event) => {
                              const value =
                                Number(
                                  event.target.value
                                );

                              if (
                                Number.isFinite(
                                  value
                                )
                              ) {
                                setBudgetKrw(
                                  Math.min(
                                    500_000,
                                    Math.max(
                                      1_000,
                                      Math.round(
                                        value
                                      )
                                    )
                                  )
                                );

                                setSelectedRestaurantId(
                                  null
                                );
                              }
                            }}
                            aria-label="1인 최대 예산"
                            className="min-w-0 flex-1 bg-transparent py-3 text-sm font-bold text-gray-800 outline-none"
                          />

                          <span className="text-xs font-bold text-gray-400">
                            원
                          </span>

                        </div>

                      </label>


                      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-3">

                        <input
                          type="checkbox"
                          checked={
                            includeUnknownPrice
                          }
                          onChange={(event) => {
                            setIncludeUnknownPrice(
                              event.target.checked
                            );

                            setSelectedRestaurantId(
                              null
                            );
                          }}
                          className="h-4 w-4 accent-emerald-500"
                        />

                        <div>

                          <p className="text-xs font-bold text-gray-700">
                            가격 미확인 식당도 포함
                          </p>

                          <p className="mt-0.5 text-[10px] leading-4 text-gray-400">
                            가격 데이터가 없는 식당을 추천에서 숨길지 선택해요.
                          </p>

                        </div>

                      </label>

                    </>
                  )}

                </section>


                {/* 주차 */}
                <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">

                  <label className="flex cursor-pointer items-start justify-between gap-3">

                    <div>

                      <p className="text-xs font-bold text-gray-800">
                        🅿 주차 가능한 곳만
                      </p>

                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        켜면 주차 불가로 확인된 식당을 추천에서 제외해요.
                      </p>

                    </div>

                    <input
                      type="checkbox"
                      checked={
                        parkingRequired
                      }
                      onChange={(event) => {
                        setParkingRequired(
                          event.target.checked
                        );

                        setSelectedRestaurantId(
                          null
                        );
                      }}
                      className="mt-0.5 h-5 w-5 accent-blue-500"
                    />

                  </label>


                  {parkingRequired && (
                    <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-3">

                      <input
                        type="checkbox"
                        checked={
                          includeUnknownParking
                        }
                        onChange={(event) => {
                          setIncludeUnknownParking(
                            event.target.checked
                          );

                          setSelectedRestaurantId(
                            null
                          );
                        }}
                        className="h-4 w-4 accent-blue-500"
                      />

                      <div>

                        <p className="text-xs font-bold text-gray-700">
                          주차 정보 미확인 식당도 포함
                        </p>

                        <p className="mt-0.5 text-[10px] leading-4 text-gray-400">
                          현재 주차 데이터가 없는 식당이 많아 기본으로 포함해요.
                        </p>

                      </div>

                    </label>
                  )}


                  <p className="mt-3 text-[10px] leading-4 text-blue-500/80">
                    주차 정보는 추후 관리자/사용자 제보 데이터가 연결되면 이 설정에 바로 반영돼요.
                  </p>

                </section>


                {/* 술집 */}
                <section className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">

                  <label className="flex cursor-pointer items-start justify-between gap-3">

                    <div>

                      <p className="text-xs font-bold text-gray-800">
                        🍺 술집도 보기
                      </p>

                      <p className="mt-1 text-[11px] leading-4 text-gray-500">
                        점심/식사 추천에서는 기본으로 제외해요. 켜면 일반 음식점 아래에 술집을 따로 표시해요.
                      </p>

                    </div>

                    <input
                      type="checkbox"
                      checked={
                        includeBars
                      }
                      onChange={(event) => {
                        setIncludeBars(
                          event.target.checked
                        );

                        setSelectedRestaurantId(
                          null
                        );
                      }}
                      className="mt-0.5 h-5 w-5 accent-violet-500"
                    />

                  </label>

                </section>


                <div className="rounded-2xl bg-gray-900 px-4 py-3 text-white">

                  <p className="text-xs font-bold text-orange-300">
                    설정 적용 방식
                  </p>

                  <p className="mt-1 text-[11px] leading-5 text-white/65">
                    개인설정은 식당을 먼저 필터링하고, 남은 식당을 추천 탭의 메뉴 취향/거리 비율로 정렬해요.
                  </p>

                </div>

              </div>
            )}

          </div>

          {/* =================================================
              MAP
          ================================================= */}

          <section className="relative h-[460px] bg-gray-100">

            <div
              ref={
                mapElementRef
              }
              className="h-full w-full"
            />
            

            {/* 지도 로딩 */}

            {(!mapLoaded ||
              !locationLoaded) &&
              !mapError && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-100">

                  <div className="text-center">

                    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />

                    <p className="text-sm text-gray-500">
                      지도를 불러오는 중...
                    </p>

                  </div>

                </div>
              )}

            {/* 지도 오류 */}

            {mapError && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-100 px-8">

                <div className="text-center">

                  <div className="text-4xl">
                    🗺️
                  </div>

                  <p className="mt-3 font-bold">
                    지도를 불러오지 못했어요
                  </p>

                  <p className="mt-2 text-sm text-gray-500">
                    {mapError}
                  </p>
                  <button type="button" onClick={() => router.push("/location")} className="mt-4 rounded-xl bg-orange-500 px-4 py-2 text-sm text-white">위치 다시 설정</button>

                </div>

              </div>
            )}

            {/* =================================================
                선택 음식점 MAP CARD
            ================================================= */}

            {selectedRestaurant && (
              <div className="absolute left-3 right-3 top-3 z-20">

                <div className="rounded-2xl border border-orange-100 bg-white/95 p-4 shadow-xl backdrop-blur">

                  <div className="flex items-start justify-between gap-3">

                    <div className="min-w-0">

                      <p className="truncate font-bold text-gray-900">
                        {
                          selectedRestaurant.name
                        }
                      </p>

                      <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                        {selectedRestaurant.venueType ===
                        "bar"
                          ? `🍺 술집 · ${selectedRestaurant.category}`
                          : selectedRestaurant.category}
                      </p>

                    </div>

                    <div className="shrink-0 rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white">
                      {getRestaurantScore(
                        selectedRestaurant
                      )}
                    </div>

                  </div>

                  <div className="mt-2">
                    {renderBusinessStatus(
                      selectedRestaurant
                    )}
                  </div>

                  <div className="mt-2 rounded-xl bg-orange-50 px-3 py-3">

                    <p className="text-[11px] font-bold text-orange-500">
                      AI 추천 메뉴
                    </p>

                    <div className="mt-1 flex items-center justify-between gap-3">

                      <p className="truncate text-sm font-extrabold text-gray-900">
                        🍽️ {
                          getRecommendedMenuLabel(
                            selectedRestaurant
                          )
                        }
                      </p>

                      {selectedRestaurant.recommendedMenuScore !==
                        null && (
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-orange-500">
                          메뉴 {Math.round(
                            selectedRestaurant.recommendedMenuScore
                          )}
                        </span>
                      )}

                    </div>

                  </div>


                  <div className="mt-2 rounded-xl bg-emerald-50/70 px-3 py-2">

                    <div className="flex items-center justify-between gap-3">

                      <div className="min-w-0">

                        <p className="text-xs font-bold text-emerald-700">
                          💰 {
                            getPriceSummary(
                              selectedRestaurant
                            ).text
                          }
                        </p>

                        <p className="mt-0.5 truncate text-[11px] text-emerald-700/70">
                          {
                            getPriceSummary(
                              selectedRestaurant
                            ).subtext
                          }
                        </p>

                      </div>


                    </div>

                  </div>

                  <div className="mt-3 flex items-center gap-2">

                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                      📍{" "}
                      {formatDistance(
                        selectedRestaurant.distance
                      )}
                    </span>

                    {mode === "recommend" &&
                      selectedRestaurant
                        .matchedPreferences
                        .slice(0, 2)
                        .map(
                          (
                            preference
                          ) => (
                            <span
                              key={
                                preference
                              }
                              className="rounded-full bg-orange-50 px-2.5 py-1 text-xs text-orange-600"
                            >
                              {
                                preference
                              }
                            </span>
                          )
                        )}

                  </div>

                </div>

              </div>
            )}
            {/* 지도 중심 위치 액션 */}
            {mapLoaded && !mapError && (
              <div className="absolute bottom-4 left-3 z-20 flex gap-2">

                <button
                  type="button"
                  onClick={useMapCenterAsLocation}
                  className="rounded-xl bg-orange-500 px-4 py-3 text-xs font-bold text-white shadow-lg transition hover:bg-orange-600"
                >
                  지도 중심으로 검색
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSaveLocationName("");
                    setShowSaveLocation(true);
                  }}
                  className="rounded-xl bg-white px-4 py-3 text-xs font-bold text-gray-700 shadow-lg transition hover:bg-gray-50"
                >
                  ☆ 기준 위치 저장
                </button>

              </div>
            )}
            {/* 현재 위치 */}

            {location &&
              !mapError && (
                <button
                  type="button"
                  onClick={
                    moveToSearchLocation
                  }
                  className="absolute bottom-4 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl shadow-lg"
                >
                  ◎
                </button>
              )}

          </section>

          {/* =================================================
              LIST
          ================================================= */}

          <section className="bg-white px-5 py-5">
          {/* 저장된 위치 */}
            {savedLocations.length > 0 && (
              <div className="mb-5">

                <div className="mb-3 flex items-center justify-between">

                  <p className="text-xs font-semibold text-gray-500">
                    저장된 위치
                  </p>

                  <span className="text-[11px] text-gray-300">
                    {savedLocations.length}개
                  </span>

                </div>

                <div className="flex flex-wrap gap-2">

                  {savedLocations.map((saved) => (
                    <div
                      key={saved.id}
                      className="flex items-center overflow-hidden rounded-full border border-orange-100 bg-orange-50"
                    >

                      <button
                        type="button"
                        onClick={() =>
                          moveToSavedLocation(saved)
                        }
                        className="py-2 pl-3 pr-2 text-xs font-semibold text-orange-600 transition hover:bg-orange-100"
                      >
                        {saved.name === "우리집"
                          ? "🏠 "
                          : saved.name === "회사"
                            ? "🏢 "
                            : saved.name === "학교"
                              ? "🎓 "
                              : "📍 "}

                        {saved.name}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          openLocationManage(saved)
                        }
                        className="flex h-8 w-8 items-center justify-center border-l border-orange-100 text-sm font-bold text-orange-400 transition hover:bg-orange-100 hover:text-orange-600"
                        aria-label={`${saved.name} 관리`}
                      >
                        ⋯
                      </button>

                    </div>
                  ))}

                </div>

              </div>
            )}
            {regionName && (
              <p className="text-xs font-semibold text-orange-500">
                📍 {regionName}
              </p>
            )}

            <p className="mt-1 text-sm text-gray-500">
              {description}
            </p>

            {mode === "recommend" &&
              recommendationMode === "embedding" &&
              searchMenus.length > 0 && (
                <div className="mt-4 rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4">

                  <div className="flex items-center justify-between gap-3">

                    <div>
                      <p className="text-xs font-bold text-orange-500">
                        ✨ AI 메뉴 취향 분석
                      </p>

                      <h3 className="mt-1 font-bold text-gray-900">
                        내가 좋아할 만한 메뉴
                      </h3>
                    </div>

                    <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-orange-500 shadow-sm">
                      취향 {preferenceWeight}%
                    </span>

                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">

                    {searchMenus.map((menu) => (
                      <span
                        key={menu}
                        className="rounded-full border border-orange-100 bg-white px-3 py-1.5 text-xs font-semibold text-orange-600"
                      >
                        🍽️ {menu}
                      </span>
                    ))}

                  </div>

                  <p className="mt-3 text-[11px] leading-5 text-gray-400">
                    AI 메뉴 취향 점수는 현재 설정한 취향 비율만큼 최종 추천 점수에 반영돼요.
                  </p>

                </div>
              )}

            <div className="mt-4 flex items-end justify-between gap-3">

              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {mode === "settings"
                    ? "설정 적용 결과"
                    : "근처 추천 맛집"}
                </h2>

                {!restaurantLoading &&
                  sortedRestaurants.length > 0 && (
                    <p className="mt-1 text-xs text-gray-400">
                      {mealRestaurantCount}곳
                      {barRestaurantCount > 0
                        ? ` · 술집 ${barRestaurantCount}곳`
                        : ""}
                    </p>
                  )}
              </div>

              <button
                type="button"
                onClick={refreshRestaurants}
                disabled={
                  restaurantLoading ||
                  restaurantRefreshCooldown > 0 ||
                  !location
                }
                className="shrink-0 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-600 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="현재 기준 위치에서 음식점을 다시 검색합니다."
              >
                {restaurantLoading
                  ? "검색 중"
                  : restaurantRefreshCooldown > 0
                    ? `${restaurantRefreshCooldown}초`
                    : "↻ 새로고침"}
              </button>

            </div>

            {/* 로딩 */}

            {restaurantLoading && (
              <div className="py-12 text-center">

                <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />

                <p className="text-sm text-gray-500">
                  주변 음식점을 찾고 있어요...
                </p>

              </div>
            )}

            {/* 오류 */}

            {restaurantError && (
              <div className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-500">
                {
                  restaurantError
                }
              </div>
            )}

            {/* 검색 결과 없음 */}

            {!restaurantLoading &&
              !restaurantError &&
              sortedRestaurants.length ===
                0 && (
                <div className="mt-5 rounded-2xl bg-gray-50 p-5 text-center text-sm text-gray-500">
                  조건에 맞는 음식점을 찾지 못했어요. 개인설정의 필터를 조금 완화해보세요.
                </div>
              )}

            {/* =================================================
                음식점 카드
            ================================================= */}

            <div className="mt-4 space-y-3">

              {sortedRestaurants.map(
                (
                  restaurant,
                  index
                ) => {
                  const score =
                    getRestaurantScore(
                      restaurant
                    );

                  const selected =
                    restaurant.id ===
                    selectedRestaurantId;
                  const recommendationReason =
                    getRecommendationReason(
                      restaurant
                    );

                  const matchedAiMenus =
                    getMatchedRecommendedMenus(
                      restaurant
                    );

                  const showBarDivider =
                    restaurant.venueType ===
                      "bar" &&
                    (
                      index ===
                        0 ||
                      sortedRestaurants[
                        index -
                        1
                      ]
                        ?.venueType !==
                        "bar"
                    );

                  return (
                    <Fragment
                      key={
                        restaurant.id
                      }
                    >

                      {showBarDivider && (
                        <div className="pt-5">

                          <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">

                            <p className="text-sm font-black text-violet-700">
                              🍺 술집
                            </p>

                            <p className="mt-1 text-[11px] leading-5 text-violet-500">
                              식사 목적 음식점과 구분해서 표시해요.
                            </p>

                          </div>

                        </div>
                      )}

                    <article
                      ref={(
                        element
                      ) => {
                        restaurantCardRefs.current[
                          restaurant.id
                        ] =
                          element;
                      }}
                      onClick={() =>
                        selectRestaurant(
                          restaurant
                        )
                      }
                      className={`cursor-pointer rounded-2xl border bg-white p-4 transition ${
                        selected
                          ? "border-orange-400 shadow-lg ring-2 ring-orange-100"
                          : "border-gray-100 shadow-sm hover:border-orange-200 hover:shadow-md"
                      }`}
                    >

                      <div className="flex gap-3">

                        {/* 번호 */}

                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${
                            selected
                              ? "bg-orange-500 text-white"
                              : "bg-orange-50 text-orange-500"
                          }`}
                        >
                          {
                            index +
                            1
                          }
                        </div>

                        <div className="min-w-0 flex-1">

                          <div className="flex items-start justify-between gap-2">

                            <div className="min-w-0">

                              <h3 className="truncate font-bold text-gray-900">
                                {
                                  restaurant.name
                                }
                              </h3>

                              <p
                                className={`mt-1 line-clamp-1 text-xs ${
                                  restaurant.venueType ===
                                  "bar"
                                    ? "font-semibold text-violet-600"
                                    : "text-gray-500"
                                }`}
                              >
                                {restaurant.venueType ===
                                "bar"
                                  ? `🍺 술집 · ${restaurant.category}`
                                  : restaurant.category}
                              </p>

                              <div className="mt-2">
                                {renderBusinessStatus(
                                  restaurant,
                                  true
                                )}
                              </div>

                              <div className="mt-2 flex items-center gap-2">

                                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-600">
                                  🍽️ 추천
                                </span>

                                <span className="truncate text-xs font-bold text-gray-700">
                                  {
                                    getRecommendedMenuLabel(
                                      restaurant
                                    )
                                  }
                                </span>

                              </div>

                            </div>

                            <div
                              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                                selected
                                  ? "bg-orange-500 text-white"
                                  : "bg-orange-50 text-orange-500"
                              }`}
                            >
                              {
                                score
                              }
                            </div>

                          </div>

                          {/* 거리 / 태그 */}

                          <div className="mt-3 flex flex-wrap gap-2">

                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                              📍{" "}
                              {formatDistance(
                                restaurant.distance
                              )}
                            </span>

                            {restaurant.parkingAvailable ===
                              true && (
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
                                🅿 주차 가능
                              </span>
                            )}

                            {restaurant.parkingAvailable ===
                              false && (
                              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-400">
                                🅿 주차 불가
                              </span>
                            )}

                            <span
                              className={`rounded-full px-2.5 py-1 text-xs ${
                                restaurant.priceSource ===
                                  "unknown"
                                  ? "bg-gray-100 text-gray-400"
                                  : restaurant.priceSource ===
                                      "direct"
                                    ? "bg-emerald-50 font-semibold text-emerald-700"
                                    : "bg-blue-50 text-blue-600"
                              }`}
                            >
                              💰{" "}
                              {
                                getPriceSummary(
                                  restaurant
                                ).text
                              }
                            </span>

                            {mode === "recommend" &&
                              restaurant.matchedPreferences
                                .slice(0, 3)
                                .map(
                                (
                                  preference
                                ) => (
                                  <span
                                    key={
                                      preference
                                    }
                                    className="rounded-full bg-orange-50 px-2.5 py-1 text-xs text-orange-600"
                                  >
                                    {
                                      preference
                                    }
                                  </span>
                                )
                              )}

                          </div>
                          {/* 개인설정 예산 필터 안내 */}

                          {budgetEnabled && (
                            <div className="mt-3 rounded-2xl bg-emerald-50/70 p-3">

                              <div className="flex items-center justify-between gap-3">

                                <p className="text-xs font-bold text-emerald-700">
                                  💰 예산 확인
                                </p>

                                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-600 shadow-sm">
                                  최대 {formatPriceKrw(
                                    budgetKrw
                                  )}
                                </span>

                              </div>


                              <div className="mt-2">

                                <p className="text-xs font-bold text-orange-500">
                                  🍽️ {
                                    getRecommendedMenuLabel(
                                      restaurant
                                    )
                                  }
                                </p>

                                <p className="mt-1 text-sm font-bold text-gray-800">
                                  {
                                    getPriceSummary(
                                      restaurant
                                    ).text
                                  }
                                </p>

                                <p className="mt-1 text-xs text-gray-500">
                                  {
                                    getPriceSummary(
                                      restaurant
                                    ).subtext
                                  }
                                </p>

                              </div>


                              {restaurant.priceSource ===
                                "unknown" ? (
                                <p className="mt-2 text-[11px] leading-5 text-gray-400">
                                  가격 미확인 식당이에요. 현재 설정에서는 추천 목록에 포함하고 있어요.
                                </p>
                              ) : (
                                <p className="mt-2 text-[11px] font-semibold text-emerald-600">
                                  ✓ 설정한 예산 범위 안이에요.
                                  {restaurant.priceSource ===
                                    "regional"
                                    ? " 지역 평균 기준 참고값이에요."
                                    : ""}
                                </p>
                              )}

                            </div>
                          )}

                          {/* 추천 결과의 AI 취향 근거 */}

                          {mode === "recommend" &&
                            recommendationMode === "embedding" && (
                              <div className="mt-3 rounded-2xl bg-orange-50/70 p-3">

                                <div className="flex items-center justify-between gap-3">

                                  <p className="text-xs font-bold text-orange-700">
                                    ✨ 취향 반영
                                  </p>

                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-orange-600 shadow-sm">
                                    메뉴선호도 {restaurant.preferenceScore}
                                  </span>

                                </div>

                                {recommendationReason && (
                                  <p className="mt-2 text-xs leading-5 text-gray-600">
                                    {recommendationReason}
                                  </p>
                                )}

                                {matchedAiMenus.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">

                                    {matchedAiMenus
                                      .slice(0, 3)
                                      .map((menu) => (
                                        <span
                                          key={menu.name}
                                          className="rounded-full border border-orange-100 bg-white px-2.5 py-1 text-[11px] font-semibold text-orange-600"
                                        >
                                          🍽️ {menu.name}
                                        </span>
                                      ))}

                                  </div>
                                )}

                                <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2">
                                  <div>
                                    <p className="text-[10px] text-gray-400">
                                      메뉴선호도
                                    </p>

                                    <p className="mt-0.5 text-sm font-bold text-orange-500">
                                      {restaurant.preferenceScore}
                                    </p>
                                  </div>

                                  <p className="text-right text-[11px] leading-5 text-gray-400">
                                    최종 점수는 취향 {preferenceWeight}% +
                                    <br />
                                    거리 {distanceWeight}%로 계산해요.
                                  </p>
                                </div>

                              </div>
                            )}

                          {/* 주소 */}

                          <p className="mt-3 line-clamp-1 text-xs text-gray-400">
                            {restaurant.roadAddress ||
                              restaurant.address}
                          </p>

                          {/* 링크 */}

                          <div className="mt-3 flex flex-wrap items-center gap-3">

                            <a
                              href={getNaverMapLink(
                                restaurant
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline"
                            >
                              네이버 지도에서 보기
                              <span>→</span>
                            </a>

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();

                                openBusinessHoursEditor(
                                  restaurant
                                );
                              }}
                              className="text-xs font-semibold text-gray-500 underline decoration-gray-200 underline-offset-4 transition hover:text-orange-500"
                            >
                              {restaurant.businessHours.status ===
                              "UNKNOWN"
                                ? "영업시간 등록"
                                : "영업시간 수정"}
                            </button>

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();

                                openPriceReportEditor(
                                  restaurant
                                );
                              }}
                              className="text-xs font-semibold text-gray-500 underline decoration-gray-200 underline-offset-4 transition hover:text-orange-500"
                            >
                              {restaurant.priceSource ===
                              "direct"
                                ? "가격 수정 제보"
                                : "가격 제보"}
                            </button>

                          </div>

                        </div>

                      </div>

                    </article>

                    </Fragment>
                  );
                }
              )}

            </div>

            {!restaurantLoading &&
              closedRestaurants.length > 0 && (
                <div className="mt-8 border-t border-gray-100 pt-6">

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-gray-400">
                        추천에서 제외됨
                      </p>

                      <h3 className="mt-1 text-base font-bold text-gray-800">
                        현재 영업중이 아닌 가게
                      </h3>
                    </div>

                    <span className="text-xs text-gray-400">
                      {closedRestaurants.length}곳
                    </span>
                  </div>

                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    영업종료, 브레이크타임, 오늘 휴무인 가게는 추천 순위와 지도 마커에서 제외했어요.
                  </p>

                  <div className="mt-3 space-y-2">
                    {closedRestaurants.map(
                      (restaurant) => {
                        const styles =
                          getBusinessStatusClasses(
                            restaurant
                          );

                        return (
                          <article
                            key={`closed-${restaurant.id}`}
                            className={`rounded-2xl border p-4 ${styles.box}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="truncate text-sm font-bold text-gray-800">
                                  {restaurant.name}
                                </h4>

                                <p className="mt-1 line-clamp-1 text-[11px] text-gray-500">
                                  {restaurant.venueType ===
                                  "bar"
                                    ? `🍺 술집 · ${restaurant.category}`
                                    : restaurant.category}
                                </p>
                              </div>

                              <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-gray-500">
                                {formatDistance(
                                  restaurant.distance
                                )}
                              </span>
                            </div>

                            <div className="mt-3">
                              {renderBusinessStatus(
                                restaurant
                              )}
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-3">

                              <a
                                href={getNaverMapLink(
                                  restaurant
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline"
                              >
                                네이버 지도에서 보기
                                <span>→</span>
                              </a>

                              <button
                                type="button"
                                onClick={() =>
                                  openBusinessHoursEditor(
                                    restaurant
                                  )
                                }
                                className="text-xs font-semibold text-gray-500 underline decoration-gray-200 underline-offset-4 transition hover:text-orange-500"
                              >
                                영업시간 수정
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  openPriceReportEditor(
                                    restaurant
                                  )
                                }
                                className="text-xs font-semibold text-gray-500 underline decoration-gray-200 underline-offset-4 transition hover:text-orange-500"
                              >
                                {restaurant.priceSource ===
                                "direct"
                                  ? "가격 수정 제보"
                                  : "가격 제보"}
                              </button>

                            </div>
                          </article>
                        );
                      }
                    )}
                  </div>
                </div>
              )}

          </section>

        </div>

      </main>
      {/* 위치 저장 모달 */}
      {showSaveLocation && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 px-5">

          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">

            <div className="flex items-start justify-between">

              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  위치 저장
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  이 위치를 어떤 이름으로 저장할까요?
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowSaveLocation(false);
                  setSaveLocationName("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>

            </div>

            {/* 추천 이름 */}
            <div className="mt-5 flex gap-2">

              {["우리집", "회사", "학교"].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSaveLocationName(name)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                    saveLocationName === name
                      ? "bg-orange-500 text-white"
                      : "bg-orange-50 text-orange-600"
                  }`}
                >
                  {name === "우리집"
                    ? "🏠 "
                    : name === "회사"
                      ? "🏢 "
                      : "🎓 "}

                  {name}
                </button>
              ))}

            </div>

            {/* 이름 직접 입력 */}
            <input
              type="text"
              value={saveLocationName}
              onChange={(event) =>
                setSaveLocationName(event.target.value)
              }
              placeholder="예: 우리집"
              className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

            <div className="mt-5 flex gap-2">

              <button
                type="button"
                onClick={() => {
                  setShowSaveLocation(false);
                  setSaveLocationName("");
                }}
                className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-600"
              >
                취소
              </button>

              <button
                type="button"
                disabled={!saveLocationName.trim()}
                onClick={saveCurrentMapLocation}
                className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                저장
              </button>

            </div>

          </div>

        </div>
      )}

      {/* 가격 제보 모달 */}
      {showPriceReportModal &&
        priceReportRestaurant && (
          <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/35 px-4">

            <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">

              <div className="flex items-start justify-between gap-3">

                <div className="min-w-0">

                  <p className="text-xs font-bold text-orange-500">
                    💰 메뉴 가격 제보
                  </p>

                  <h3 className="mt-1 truncate text-lg font-bold text-gray-900">
                    {priceReportRestaurant.name}
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    실제 매장에서 확인한 메뉴 가격을 알려주세요.
                    관리자 검토 후 가격 정보와 지역 평균에 반영돼요.
                  </p>

                </div>

                <button
                  type="button"
                  onClick={
                    closePriceReportEditor
                  }
                  disabled={
                    priceReportSaving
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 disabled:opacity-40"
                  aria-label="가격 제보 닫기"
                >
                  ✕
                </button>

              </div>


              <div className="mt-4 rounded-2xl bg-gray-50 p-4">

                <p className="text-[11px] font-bold text-gray-400">
                  현재 가격 정보
                </p>

                <p className="mt-1 text-sm font-black text-gray-800">
                  {
                    getPriceSummary(
                      priceReportRestaurant
                    ).text
                  }
                </p>

                <p className="mt-1 text-[11px] leading-5 text-gray-400">
                  {
                    getPriceSummary(
                      priceReportRestaurant
                    ).subtext
                  }
                </p>

                {priceReportRestaurant.priceSource ===
                  "regional" && (
                  <p className="mt-2 text-[11px] leading-5 text-blue-500">
                    지역 평균은 참고값이에요. 제보한 실제 가격이 승인되면 이 가게의 확인 가격으로 표시돼요.
                  </p>
                )}

              </div>


              <label className="mt-5 block">

                <span className="text-xs font-bold text-gray-600">
                  메뉴 이름
                </span>

                <input
                  type="text"
                  value={
                    priceReportMenu
                  }
                  onChange={(event) => {
                    setPriceReportMenu(
                      event.target.value
                    );

                    setPriceReportError(
                      ""
                    );

                    setPriceReportSuccess(
                      ""
                    );
                  }}
                  maxLength={200}
                  placeholder="예: 돈가스"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
                />

                <p className="mt-1 text-[11px] leading-5 text-gray-400">
                  추천 메뉴가 자동으로 들어가며, 다른 메뉴를 제보할 경우 직접 수정할 수 있어요.
                </p>

              </label>


              <label className="mt-4 block">

                <span className="text-xs font-bold text-gray-600">
                  실제 가격
                </span>

                <div className="mt-2 flex items-center rounded-xl border border-gray-200 px-4 focus-within:border-orange-400">

                  <input
                    type="number"
                    min={100}
                    max={10000000}
                    step={100}
                    inputMode="numeric"
                    value={
                      priceReportPrice
                    }
                    onChange={(event) => {
                      setPriceReportPrice(
                        event.target.value
                      );

                      setPriceReportError(
                        ""
                      );

                      setPriceReportSuccess(
                        ""
                      );
                    }}
                    placeholder="예: 12000"
                    className="min-w-0 flex-1 bg-transparent py-3 text-sm font-bold text-gray-800 outline-none placeholder:text-gray-300"
                  />

                  <span className="text-xs font-bold text-gray-400">
                    원
                  </span>

                </div>

                {priceReportRestaurant.directPriceKrw !==
                  null && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    현재 확인 가격:{" "}
                    {
                      formatPriceKrw(
                        priceReportRestaurant
                          .directPriceKrw
                      )
                    }
                  </p>
                )}

              </label>


              <label className="mt-4 block">

                <span className="text-xs font-bold text-gray-600">
                  추가 설명{" "}
                  <span className="font-normal text-gray-300">
                    (선택)
                  </span>
                </span>

                <textarea
                  value={
                    priceReportNote
                  }
                  onChange={(event) => {
                    setPriceReportNote(
                      event.target.value
                    );

                    setPriceReportError(
                      ""
                    );

                    setPriceReportSuccess(
                      ""
                    );
                  }}
                  maxLength={1000}
                  rows={3}
                  placeholder="예: 매장 메뉴판에서 확인했어요."
                  className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
                />

              </label>


              <a
                href={getNaverMapLink(
                  priceReportRestaurant
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex w-full items-center justify-center rounded-xl bg-green-50 py-3 text-xs font-bold text-green-700 transition hover:bg-green-100"
              >
                네이버 지도에서 확인 →
              </a>


              {priceReportError && (
                <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-500">
                  {priceReportError}
                </div>
              )}


              {priceReportSuccess && (
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-3">

                  <p className="text-xs font-bold text-emerald-600">
                    ✓ 제보가 접수됐어요
                  </p>

                  <p className="mt-1 text-[11px] leading-5 text-emerald-600/80">
                    {priceReportSuccess}
                  </p>

                </div>
              )}


              <div className="mt-5 flex gap-2">

                <button
                  type="button"
                  disabled={
                    priceReportSaving
                  }
                  onClick={
                    closePriceReportEditor
                  }
                  className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-600 disabled:opacity-40"
                >
                  {priceReportSuccess
                    ? "닫기"
                    : "취소"}
                </button>

                {!priceReportSuccess && (
                  <button
                    type="button"
                    disabled={
                      priceReportSaving ||
                      !priceReportMenu
                        .trim() ||
                      !priceReportPrice
                    }
                    onClick={
                      submitPriceReport
                    }
                    className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {priceReportSaving
                      ? "제보 중..."
                      : "가격 제보"}
                  </button>
                )}

              </div>

            </div>

          </div>
        )}

      {/* 영업시간 등록/수정 모달 */}
      {showBusinessHoursModal &&
        businessHoursRestaurant && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 px-4">

            <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">

              <div className="flex items-start justify-between gap-3">

                <div className="min-w-0">
                  <p className="text-xs font-bold text-orange-500">
                    NAVER 스마트플레이스 기준
                  </p>

                  <h3 className="mt-1 truncate text-lg font-bold text-gray-900">
                    {businessHoursRestaurant.name}
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    네이버에서 확인한 영업시간을 입력해주세요.
                    저장하면 추천 결과에 바로 반영됩니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    closeBusinessHoursEditor
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                >
                  ✕
                </button>

              </div>


              <div className="mt-5">

                <p className="text-xs font-bold text-gray-600">
                  적용 요일
                </p>

                <div className="mt-2 grid grid-cols-7 gap-1">

                  {BUSINESS_DAY_NAMES.map(
                    (name, index) => (
                      <button
                        key={name}
                        type="button"
                        disabled={
                          businessHoursApplyAllDays
                        }
                        onClick={() =>
                          setBusinessHoursDay(
                            index
                          )
                        }
                        className={`rounded-lg py-2 text-xs font-bold transition ${
                          businessHoursDay ===
                            index &&
                          !businessHoursApplyAllDays
                            ? "bg-orange-500 text-white"
                            : "bg-gray-100 text-gray-500"
                        } disabled:opacity-40`}
                      >
                        {name}
                      </button>
                    )
                  )}

                </div>

              </div>


              <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl bg-orange-50 px-3 py-3">

                <input
                  type="checkbox"
                  checked={
                    businessHoursApplyAllDays
                  }
                  onChange={(event) =>
                    setBusinessHoursApplyAllDays(
                      event.target.checked
                    )
                  }
                  className="accent-orange-500"
                />

                <span className="text-xs font-semibold text-orange-700">
                  매일 같은 시간으로 적용
                </span>

              </label>


              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl bg-gray-50 px-3 py-3">

                <input
                  type="checkbox"
                  checked={
                    businessHoursClosed
                  }
                  onChange={(event) =>
                    setBusinessHoursClosed(
                      event.target.checked
                    )
                  }
                  className="accent-red-500"
                />

                <span className="text-xs font-semibold text-gray-700">
                  이 요일은 휴무
                </span>

              </label>


              {!businessHoursClosed && (
                <>

                  <div className="mt-5 grid grid-cols-2 gap-3">

                    <label>
                      <span className="text-xs font-semibold text-gray-500">
                        영업 시작
                      </span>

                      <input
                        type="time"
                        value={
                          businessHoursOpen
                        }
                        onChange={(event) =>
                          setBusinessHoursOpen(
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                      />
                    </label>

                    <label>
                      <span className="text-xs font-semibold text-gray-500">
                        영업 종료
                      </span>

                      <input
                        type="time"
                        value={
                          businessHoursClose
                        }
                        onChange={(event) =>
                          setBusinessHoursClose(
                            event.target.value
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                      />
                    </label>

                  </div>


                  <div className="mt-5">

                    <div>
                      <p className="text-xs font-bold text-gray-600">
                        브레이크타임
                      </p>

                      <p className="mt-1 text-[11px] text-gray-400">
                        없으면 비워두세요.
                      </p>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-3">

                      <input
                        type="time"
                        value={
                          businessHoursBreakStart
                        }
                        onChange={(event) =>
                          setBusinessHoursBreakStart(
                            event.target.value
                          )
                        }
                        className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                      />

                      <input
                        type="time"
                        value={
                          businessHoursBreakEnd
                        }
                        onChange={(event) =>
                          setBusinessHoursBreakEnd(
                            event.target.value
                          )
                        }
                        className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-orange-400"
                      />

                    </div>

                  </div>

                </>
              )}


              <a
                href={getNaverMapLink(
                  businessHoursRestaurant
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 flex w-full items-center justify-center rounded-xl bg-green-50 py-3 text-xs font-bold text-green-700 transition hover:bg-green-100"
              >
                네이버 지도에서 영업시간 확인 →
              </a>


              {businessHoursError && (
                <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-500">
                  {businessHoursError}
                </div>
              )}


              <div className="mt-5 flex gap-2">

                <button
                  type="button"
                  disabled={
                    businessHoursSaving
                  }
                  onClick={
                    closeBusinessHoursEditor
                  }
                  className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-600 disabled:opacity-40"
                >
                  취소
                </button>

                <button
                  type="button"
                  disabled={
                    businessHoursSaving
                  }
                  onClick={
                    saveBusinessHours
                  }
                  className="flex-1 rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-40"
                >
                  {businessHoursSaving
                    ? "저장 중..."
                    : "영업시간 저장"}
                </button>

              </div>

            </div>

          </div>
        )}

      {/* 저장 위치 관리 모달 */}
      {showLocationManage &&
        editingLocation && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 px-5">

            <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">

              <div className="flex items-start justify-between">

                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    저장 위치 관리
                  </h3>

                  <p className="mt-1 text-sm text-gray-500">
                    이름을 변경하거나 저장 위치를 삭제할 수 있어요.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeLocationManage}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                  aria-label="저장 위치 관리 닫기"
                >
                  ✕
                </button>

              </div>

              <div className="mt-5 flex items-center rounded-2xl bg-gray-50 px-4 py-3">

                <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-orange-50">

                  <span className="text-lg">
                    {editingLocation.name === "우리집"
                      ? "🏠"
                      : editingLocation.name === "회사"
                        ? "🏢"
                        : editingLocation.name === "학교"
                          ? "🎓"
                          : "📍"}
                  </span>

                </div>

                <div>
                  <p className="text-sm font-bold text-gray-800">
                    {editingLocation.name}
                  </p>

                  <p className="mt-0.5 text-[11px] text-gray-400">
                    저장된 위치
                  </p>
                </div>

              </div>

              <div className="mt-5">

                <label className="text-xs font-semibold text-gray-500">
                  위치 이름
                </label>

                <input
                  type="text"
                  value={editingLocationName}
                  onChange={(event) =>
                    setEditingLocationName(
                      event.target.value
                    )
                  }
                  placeholder="예: 우리집"
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 outline-none transition focus:border-orange-400"
                />

              </div>

              <div className="mt-3 flex gap-2">

                {["우리집", "회사", "학교"].map(
                  (name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        setEditingLocationName(name)
                      }
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                        editingLocationName === name
                          ? "bg-orange-500 text-white"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {name === "우리집"
                        ? "🏠 "
                        : name === "회사"
                          ? "🏢 "
                          : "🎓 "}

                      {name}
                    </button>
                  )
                )}

              </div>

              <button
                type="button"
                disabled={
                  !editingLocationName.trim()
                }
                onClick={renameSavedLocation}
                className="mt-5 w-full rounded-xl bg-orange-500 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이름 변경
              </button>

              <div className="my-4 h-px bg-gray-100" />

              <button
                type="button"
                onClick={deleteSavedLocation}
                className="w-full rounded-xl bg-red-50 py-3 text-sm font-bold text-red-500 transition hover:bg-red-100"
              >
                저장 위치 삭제
              </button>

            </div>

          </div>
        )}
    </>
  );
}
