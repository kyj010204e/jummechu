"use client";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { parseCoordinate } from "@/lib/validation";
import {
  FormEvent,
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
type Restaurant = {
  id: string;
  name: string;
  category: string;
  address: string;
  roadAddress: string;

  latitude: number;
  longitude: number;

  distance: number;

  matchedPreferences: string[];

  preferenceScore: number;
  distanceScore: number;
  recommendScore: number;
};

type RestaurantResponse = {
  region: {
    area1: string;
    area2: string;
    area3: string;
    displayName: string;
  };

  preferences: string[];

  restaurants: Restaurant[];

  message?: string;
};

type Mode =
  | "recommend"
  | "value"
  | "preference";

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
     4. 음식점 API
  ======================================================= */

  useEffect(() => {
    if (!location) return;

    const controller = new AbortController();
    async function loadRestaurants() {
      try {
        setRestaurantLoading(true);

        setRestaurantError("");

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
          data.restaurants ??
            []
        );

        setRegionName(
          data.region
            ?.displayName ??
            ""
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
  }, [location]);

  /* =======================================================
     5. MASK별 정렬
  ======================================================= */

  const sortedRestaurants =
    useMemo(() => {
      const result =
        [...restaurants];

      /*
       * 추천
       */
      if (
        mode ===
        "recommend"
      ) {
        result.sort(
          (a, b) =>
            b.recommendScore -
            a.recommendScore
        );
      }

      /*
       * 메뉴선호도
       */
      if (
        mode ===
        "preference"
      ) {
        result.sort(
          (a, b) =>
            b.preferenceScore -
            a.preferenceScore
        );
      }

      /*
       * 가성비
       *
       * 아직 가격 데이터 X
       * → 가까운 순
       */
      if (
        mode ===
        "value"
      ) {
        result.sort(
          (a, b) =>
            a.distance -
            b.distance
        );
      }

      return result;
    }, [
      restaurants,
      mode,
    ]);

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
        restaurants.find(
          (restaurant) =>
            restaurant.id ===
            selectedRestaurantId
        ) ?? null
      );
    }, [
      restaurants,
      selectedRestaurantId,
    ]);

  /* =======================================================
     현재 MASK 점수
  ======================================================= */

  const getRestaurantScore = useCallback((restaurant: Restaurant) => {
    if (
      mode ===
      "preference"
    ) {
      return restaurant
        .preferenceScore;
    }

    if (
      mode ===
      "value"
    ) {
      return restaurant
        .distanceScore;
    }

    return restaurant
      .recommendScore;
  }, [mode]);

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
      restaurants.length ===
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

    restaurants.forEach(
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
    restaurants,
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

  /* =======================================================
     MASK 설명
  ======================================================= */

  const description = (() => {
    if (
      mode ===
      "recommend"
    ) {
      return "내 메뉴 취향과 거리를 함께 반영했어요";
    }

    if (
      mode ===
      "preference"
    ) {
      return "내가 선택한 메뉴와 잘 맞는 곳부터 보여줘요";
    }

    return "가격 데이터 연결 전이라 현재는 가까운 곳부터 보여줘요";
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

          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">

            <button
              type="button"
              onClick={() =>
                window.history.back()
              }
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 transition hover:bg-gray-100"
            >
              ←
            </button>

            <h1 className="text-lg font-bold text-gray-900">
              점메추
            </h1>

            <button
              type="button"
              onClick={() =>
                router.push(
                  "/mypage"
                )
              }
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-gray-500 transition hover:bg-gray-100"
              aria-label="마이페이지"
            >
              👤
            </button>

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
              MASK
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
                    "value"
                  )
                }
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                  mode ===
                  "value"
                    ? "bg-white text-orange-500 shadow-sm"
                    : "text-gray-500"
                }`}
              >
                가성비
              </button>

              <button
                type="button"
                onClick={() =>
                  setMode(
                    "preference"
                  )
                }
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                  mode ===
                  "preference"
                    ? "bg-white text-orange-500 shadow-sm"
                    : "text-gray-500"
                }`}
              >
                메뉴선호도
              </button>

            </div>

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
                        {
                          selectedRestaurant.category
                        }
                      </p>

                    </div>

                    <div className="shrink-0 rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white">
                      {getRestaurantScore(
                        selectedRestaurant
                      )}
                    </div>

                  </div>

                  <div className="mt-3 flex items-center gap-2">

                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                      📍{" "}
                      {formatDistance(
                        selectedRestaurant.distance
                      )}
                    </span>

                    {selectedRestaurant
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

            <div className="mt-1 flex items-end justify-between">

              <h2 className="text-xl font-bold text-gray-900">
                근처 추천 맛집
              </h2>

              {!restaurantLoading &&
                restaurants.length >
                  0 && (
                  <span className="text-xs text-gray-400">
                    {
                      restaurants.length
                    }
                    곳
                  </span>
                )}

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
                  주변 음식점을 찾지 못했어요.
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

                  return (
                    <article
                      key={
                        restaurant.id
                      }
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

                              <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                                {
                                  restaurant.category
                                }
                              </p>

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

                            {restaurant.matchedPreferences.map(
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

                          {/* 주소 */}

                          <p className="mt-3 line-clamp-1 text-xs text-gray-400">
                            {restaurant.roadAddress ||
                              restaurant.address}
                          </p>

                          {/* 링크 */}

                          <a
                            href={getNaverMapLink(
                              restaurant
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline"
                          >
                            네이버 지도에서 보기
                            <span>→</span>
                          </a>

                        </div>

                      </div>

                    </article>
                  );
                }
              )}

            </div>

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
