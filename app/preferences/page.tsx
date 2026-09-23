"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const menus = [
  {
    id: "korean",
    name: "한식",
    emoji: "🍚",
  },
  {
    id: "noodle",
    name: "면류",
    emoji: "🍜",
  },
  {
    id: "chicken",
    name: "치킨",
    emoji: "🍗",
  },
  {
    id: "pizza",
    name: "피자",
    emoji: "🍕",
  },
  {
    id: "meat",
    name: "고기",
    emoji: "🥩",
  },
  {
    id: "japanese",
    name: "일식",
    emoji: "🍣",
  },
  {
    id: "burger",
    name: "버거",
    emoji: "🍔",
  },
  {
    id: "chinese",
    name: "중식",
    emoji: "🥟",
  },
  {
    id: "cafe",
    name: "카페",
    emoji: "☕",
  },
];

type PreferencesResponse = {
  success: boolean;
  message?: string;
  preferences?: string[];
};

export default function PreferencesPage() {
  const router = useRouter();

  const [selectedMenus, setSelectedMenus] =
    useState<string[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function loadPreferences() {
      try {
        const response = await fetch("/api/preferences", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { router.replace("/login"); return; }
        const data = await response.json() as PreferencesResponse;
        if (!response.ok) throw new Error(data.message ?? "선호 메뉴를 불러오지 못했습니다.");
        if (!controller.signal.aborted) {
          setSelectedMenus((data.preferences ?? []).filter((id) => menus.some((menu) => menu.id === id)));
          setLoaded(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "선호 메뉴를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setInitialLoading(false);
      }
    }
    void loadPreferences();
    return () => controller.abort();
  }, [router]);

  /* =========================================================
     메뉴 클릭
  ========================================================= */

  const toggleMenu = (
    menuId: string
  ) => {
    console.log(
      "메뉴 클릭:",
      menuId
    );

    setSelectedMenus(
      (current) => {
        if (
          current.includes(
            menuId
          )
        ) {
          return current.filter(
            (id) =>
              id !== menuId
          );
        }

        return [
          ...current,
          menuId,
        ];
      }
    );

    setError("");
  };

  /* =========================================================
     저장
  ========================================================= */

  const handleNext =
    async () => {
      if (!loaded || initialLoading || loading) return;
      if (
        selectedMenus.length <
        3
      ) {
        setError(
          "선호 메뉴를 3개 이상 선택해주세요."
        );

        return;
      }

      try {
        setLoading(true);
        setError("");

        const response =
          await fetch(
            "/api/preferences",
            {
              method: "PUT",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  preferences:
                    selectedMenus,
                }),
            }
          );

        const data =
          (await response.json()) as PreferencesResponse;

        if (!response.ok) {
          throw new Error(
            data.message ??
              "선호 메뉴 저장에 실패했습니다."
          );
        }

        localStorage.removeItem("jummechu_preferences");

        router.push(
          "/location"
        );
      } catch (error) {
        console.error(
          "선호도 저장 오류:",
          error
        );

        if (
          error instanceof Error
        ) {
          setError(
            error.message
          );
        } else {
          setError(
            "선호 메뉴 저장 중 문제가 발생했습니다."
          );
        }
      } finally {
        setLoading(false);
      }
    };

  return (
    <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

      <div className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-md flex-col">

        {/* 상단 */}

        <header className="mb-8 flex items-center justify-between">

          <button
            type="button"
            onClick={() =>
              router.back()
            }
            className="flex h-8 w-8 items-center justify-center text-2xl text-gray-700"
            aria-label="뒤로가기"
          >
            ‹
          </button>

          <div className="rounded-full bg-orange-50 px-3 py-1.5">

            <span className="text-xs font-bold text-orange-500">
              {selectedMenus.length}개 선택
            </span>

          </div>

        </header>

        {/* 제목 */}

        <section className="mb-7">

          <p className="mb-2 text-sm font-semibold text-orange-500">
            점메추 취향 설정
          </p>

          <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-gray-900">
            가장 좋아하는 음식 종류는?
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            평소 좋아하는 음식 3가지 이상을
            <br />
            선택해주세요.
          </p>

        </section>

        {initialLoading && <p role="status" className="mb-4 text-sm text-gray-500">저장된 취향을 불러오는 중...</p>}
        {!initialLoading && !loaded && <button type="button" onClick={() => window.location.reload()} className="mb-4 text-sm text-orange-600">다시 불러오기</button>}
        {/* 메뉴 */}

        <section className="grid grid-cols-3 gap-3">

          {menus.map(
            (menu) => {
              const isSelected =
                selectedMenus.includes(
                  menu.id
                );

              return (
                <button
                  key={menu.id}
                  disabled={initialLoading || loading || !loaded}
                  type="button"

                  onClick={() => {
                    toggleMenu(
                      menu.id
                    );
                  }}

                  className={`
                    relative
                    z-10
                    flex
                    aspect-square
                    cursor-pointer
                    flex-col
                    items-center
                    justify-center
                    rounded-2xl
                    transition-all
                    duration-150

                    ${
                      isSelected
                        ? "border-2 border-orange-500 bg-orange-50 shadow-md"
                        : "border-2 border-transparent bg-white shadow-sm hover:border-orange-200"
                    }
                  `}
                >

                  {isSelected && (
                    <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[11px] font-bold text-white">
                      ✓
                    </span>
                  )}

                  <span className="pointer-events-none mb-3 text-[38px] leading-none">
                    {menu.emoji}
                  </span>

                  <span
                    className={`pointer-events-none text-sm font-semibold ${
                      isSelected
                        ? "text-orange-600"
                        : "text-gray-800"
                    }`}
                  >
                    {menu.name}
                  </span>

                </button>
              );
            }
          )}

        </section>

        {/* 안내 */}

        <div className="mt-5 rounded-xl bg-white px-4 py-3">

          <p className="text-center text-xs text-gray-400">

            {selectedMenus.length <
            3
              ? `최소 ${
                  3 -
                  selectedMenus.length
                }개를 더 선택해주세요.`
              : `${selectedMenus.length}개의 선호 메뉴를 선택했어요!`}

          </p>

        </div>

        {/* 오류 */}

        {error && (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3">

            <p className="text-center text-xs text-red-500">
              {error}
            </p>

          </div>
        )}

        {/* 저장 버튼 */}

        <div className="mt-auto pt-6">

          <button
            type="button"

            onClick={
              handleNext
            }

            disabled={
              selectedMenus.length <
                3 ||
              loading || initialLoading || !loaded
            }

            className={`
              w-full
              rounded-xl
              py-4
              text-sm
              font-bold
              transition-all

              ${
                selectedMenus.length >=
                  3 &&
                !loading && !initialLoading && loaded
                  ? "cursor-pointer bg-orange-500 text-white shadow-lg shadow-orange-100 hover:bg-orange-600 active:scale-[0.98]"
                  : "cursor-not-allowed bg-gray-200 text-gray-400"
              }
            `}
          >

            {loading
              ? "선호도 저장 중..."
              : "선호도 저장하고 계속하기"}

          </button>

        </div>

      </div>

    </main>
  );
}
