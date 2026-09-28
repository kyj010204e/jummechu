"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  getPreferenceCategoryIds,
  MIN_DETAIL_PREFERENCES,
  PREFERENCE_CATEGORIES,
} from "@/lib/preference-catalog";


type PreferenceResponse = {
  message?: string;
  selectedMenus?: string[];
  favoriteMenus?: string[];
  selectedCategoryIds?: string[];
  preferenceCount?: number;
};


export default function PreferencesPage() {

  const router =
    useRouter();


  const [
    selectedMenus,
    setSelectedMenus,
  ] =
    useState<string[]>(
      []
    );


  const [
    favoriteMenus,
    setFavoriteMenus,
  ] =
    useState<string[]>(
      []
    );


  const [
    activeCategoryId,
    setActiveCategoryId,
  ] =
    useState<string>(
      PREFERENCE_CATEGORIES[0].id
    );


  const [
    loading,
    setLoading,
  ] =
    useState(true);


  const [
    saving,
    setSaving,
  ] =
    useState(false);


  const [
    error,
    setError,
  ] =
    useState("");


  const activeCategory =
    useMemo(
      () =>
        PREFERENCE_CATEGORIES.find(
          (category) =>
            category.id ===
            activeCategoryId
        ) ??
        PREFERENCE_CATEGORIES[0],

      [
        activeCategoryId,
      ]
    );


  const selectedMenuSet =
    useMemo(
      () =>
        new Set(
          selectedMenus
        ),

      [
        selectedMenus,
      ]
    );


  const favoriteMenuSet =
    useMemo(
      () =>
        new Set(
          favoriteMenus
        ),

      [
        favoriteMenus,
      ]
    );


  const selectedCategoryIds =
    useMemo(
      () =>
        getPreferenceCategoryIds(
          selectedMenus
        ),

      [
        selectedMenus,
      ]
    );


  const canSave =
    selectedMenus.length >=
      MIN_DETAIL_PREFERENCES &&
    !saving;


  /* =======================================================
     기존 선택 불러오기
  ======================================================= */

  useEffect(() => {

    const controller =
      new AbortController();


    async function loadPreferences() {

      try {

        setLoading(
          true
        );

        setError(
          ""
        );


        const response =
          await fetch(
            "/api/preferences",
            {
              cache:
                "no-store",

              signal:
                controller.signal,
            }
          );


        const data =
          (
            await response.json()
          ) as PreferenceResponse;


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
              "선호 메뉴를 불러오지 못했습니다."
          );
        }


        if (
          controller.signal.aborted
        ) {

          return;
        }


        const menus =
          Array.isArray(
            data.selectedMenus
          )
            ? data.selectedMenus
            : [];


        setSelectedMenus(
          menus
        );


        setFavoriteMenus(
          Array.isArray(
            data.favoriteMenus
          )
            ? data.favoriteMenus.filter(
                (menu) =>
                  menus.includes(
                    menu
                  )
              )
            : []
        );


        if (
          menus.length > 0
        ) {

          const firstCategory =
            PREFERENCE_CATEGORIES.find(
              (category) =>
                category.menus.some(
                  (menu) =>
                    menus.includes(
                      menu
                    )
                )
            );


          if (
            firstCategory
          ) {

            setActiveCategoryId(
              firstCategory.id
            );
          }
        }


      } catch (loadError) {

        if (
          controller.signal.aborted
        ) {

          return;
        }


        console.error(
          loadError
        );


        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "선호 메뉴를 불러오지 못했습니다."
        );


      } finally {

        if (
          !controller.signal.aborted
        ) {

          setLoading(
            false
          );
        }
      }
    }


    void loadPreferences();


    return () => {

      controller.abort();
    };

  }, [router]);


  /* =======================================================
     메뉴 선택
  ======================================================= */

  function toggleMenu(
    menu: string
  ) {

    setError(
      ""
    );


    setSelectedMenus(
      (
        current
      ) => {

        if (
          current.includes(
            menu
          )
        ) {

          setFavoriteMenus(
            (
              favorites
            ) =>
              favorites.filter(
                (item) =>
                  item !==
                  menu
              )
          );


          return current.filter(
            (item) =>
              item !==
              menu
          );
        }


        return [
          ...current,
          menu,
        ];
      }
    );
  }


  function removeSelectedMenu(
    menu: string
  ) {

    setSelectedMenus(
      (current) =>
        current.filter(
          (item) =>
            item !==
            menu
        )
    );


    setFavoriteMenus(
      (current) =>
        current.filter(
          (item) =>
            item !==
            menu
        )
    );


    setError(
      ""
    );
  }


  function toggleFavoriteMenu(
    menu: string
  ) {

    if (
      !selectedMenuSet.has(
        menu
      )
    ) {

      return;
    }


    setFavoriteMenus(
      (
        current
      ) => {

        if (
          current.includes(
            menu
          )
        ) {

          return current.filter(
            (item) =>
              item !==
              menu
          );
        }


        return [
          ...current,
          menu,
        ];
      }
    );


    setError(
      ""
    );
  }


  /* =======================================================
     저장
  ======================================================= */

  async function savePreferences() {

    if (
      selectedMenus.length <
      MIN_DETAIL_PREFERENCES
    ) {

      setError(
        `좋아하는 세부 메뉴를 최소 ${MIN_DETAIL_PREFERENCES}개 선택해주세요.`
      );

      return;
    }


    try {

      setSaving(
        true
      );

      setError(
        ""
      );


      const response =
        await fetch(
          "/api/preferences",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                selectedMenus,
                favoriteMenus,
              }),
          }
        );


      const data =
        (
          await response.json()
        ) as PreferenceResponse;


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
            "선호 메뉴 저장에 실패했습니다."
        );
      }


      localStorage.setItem(
        "jummechu_preferences",
        JSON.stringify(
          data.selectedCategoryIds ??
            selectedCategoryIds
        )
      );


      localStorage.setItem(
        "jummechu_food_preferences",
        JSON.stringify(
          data.selectedMenus ??
            selectedMenus
        )
      );


      localStorage.setItem(
        "jummechu_favorite_foods",
        JSON.stringify(
          data.favoriteMenus ??
            favoriteMenus
        )
      );


      /*
       * "/"는 현재 비로그인 랜딩 화면 성격이 있어
       * 로그인 버튼이 다시 보이면서 루프처럼 느껴질 수 있습니다.
       *
       * 저장 성공 후에는 인증된 사용자의 실제 메인 기능 화면인
       * /map 으로 이동합니다.
       */
      router.replace("/map");


    } catch (saveError) {

      console.error(
        saveError
      );


      setError(
        saveError instanceof
          Error
          ? saveError.message
          : "선호 메뉴 저장에 실패했습니다."
      );


    } finally {

      setSaving(
        false
      );
    }
  }


  /* =======================================================
     로딩
  ======================================================= */

  if (
    loading
  ) {

    return (
      <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

        <div className="mx-auto w-full max-w-md">

          <div className="h-8 w-8 rounded-full bg-gray-100" />

          <div className="mt-12 h-4 w-28 animate-pulse rounded-full bg-orange-100" />

          <div className="mt-4 h-9 w-72 animate-pulse rounded-xl bg-gray-200" />

          <div className="mt-3 h-5 w-60 animate-pulse rounded-lg bg-gray-100" />

          <div className="mt-8 grid grid-cols-2 gap-3">

            {Array.from({
              length: 8,
            }).map(
              (
                _,
                index
              ) => (
                <div
                  key={
                    index
                  }
                  className="h-28 animate-pulse rounded-3xl bg-white shadow-sm"
                />
              )
            )}

          </div>

        </div>

      </main>
    );
  }


  return (
    <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

      <div className="mx-auto w-full max-w-md pb-32">

        {/* 상단 */}
        <header className="flex items-center justify-between">

          <button
            type="button"
            onClick={() =>
              router.back()
            }
            className="flex h-9 w-9 items-center justify-center rounded-full text-2xl text-gray-700 transition hover:bg-white"
            aria-label="뒤로가기"
          >
            ‹
          </button>


          <div className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-500">
            {selectedMenus.length}개 선택
          </div>

        </header>


        {/* 제목 */}
        <section className="mt-10">

          <p className="text-sm font-extrabold text-orange-500">
            점메추 취향 설정
          </p>

          <h1 className="mt-3 text-[28px] font-extrabold leading-tight tracking-tight text-gray-950">
            어떤 메뉴를
            <br />
            좋아하세요?
          </h1>

          <p className="mt-4 text-sm leading-6 text-gray-500">
            먼저 음식 종류를 고르고,
            <br />
            좋아하는 세부 메뉴를 {MIN_DETAIL_PREFERENCES}개 이상 선택해주세요.
          </p>

        </section>


        {/* 카테고리 */}
        <section className="mt-8">

          <div className="mb-3 flex items-end justify-between">

            <div>
              <p className="text-xs font-extrabold text-gray-800">
                1. 음식 종류 선택
              </p>

              <p className="mt-1 text-[11px] text-gray-400">
                누르면 아래에 세부 메뉴가 열려요.
              </p>
            </div>

            <span className="text-[11px] font-semibold text-gray-400">
              {selectedCategoryIds.length}개 카테고리
            </span>

          </div>


          <div className="grid grid-cols-2 gap-3">

            {PREFERENCE_CATEGORIES.map(
              (
                category
              ) => {

                const selectedCount =
                  category.menus.filter(
                    (menu) =>
                      selectedMenuSet.has(
                        menu
                      )
                  ).length;


                const active =
                  activeCategoryId ===
                  category.id;


                const hasSelection =
                  selectedCount > 0;


                return (
                  <button
                    key={
                      category.id
                    }
                    type="button"
                    onClick={() =>
                      setActiveCategoryId(
                        category.id
                      )
                    }
                    className={`relative min-h-[112px] rounded-3xl border p-4 text-left transition ${
                      active
                        ? "border-orange-500 bg-orange-50 shadow-md ring-2 ring-orange-100"
                        : hasSelection
                          ? "border-orange-200 bg-white shadow-sm"
                          : "border-gray-100 bg-white shadow-sm hover:border-orange-200"
                    }`}
                  >

                    <div className="flex items-start justify-between gap-2">

                      <span className="text-3xl">
                        {
                          category.emoji
                        }
                      </span>


                      {hasSelection && (
                        <span className="rounded-full bg-orange-500 px-2 py-1 text-[10px] font-bold text-white">
                          {selectedCount}개
                        </span>
                      )}

                    </div>


                    <p
                      className={`mt-3 text-sm font-extrabold ${
                        active ||
                        hasSelection
                          ? "text-orange-600"
                          : "text-gray-800"
                      }`}
                    >
                      {
                        category.label
                      }
                    </p>


                    <p className="mt-1 line-clamp-1 text-[10px] text-gray-400">
                      {
                        category.description
                      }
                    </p>

                  </button>
                );
              }
            )}

          </div>

        </section>


        {/* 세부 메뉴 */}
        <section className="mt-5 rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm">

          <div className="flex items-start justify-between gap-3">

            <div className="min-w-0">

              <p className="text-xs font-bold text-orange-500">
                2. 세부 메뉴 선택
              </p>

              <div className="mt-2 flex items-center gap-2">

                <span className="text-3xl">
                  {
                    activeCategory.emoji
                  }
                </span>

                <div className="min-w-0">

                  <h2 className="text-xl font-extrabold text-gray-900">
                    {
                      activeCategory.label
                    }
                  </h2>

                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {
                      activeCategory.description
                    }
                  </p>

                </div>

              </div>

            </div>


            <span className="shrink-0 rounded-full bg-gray-50 px-2.5 py-1.5 text-[11px] font-bold text-gray-500">
              {
                activeCategory.menus.filter(
                  (menu) =>
                    selectedMenuSet.has(
                      menu
                    )
                ).length
              }
              /{
                activeCategory.menus.length
              }
            </span>

          </div>


          <div className="mt-5 grid grid-cols-2 gap-2.5">

            {activeCategory.menus.map(
              (
                menu
              ) => {

                const selected =
                  selectedMenuSet.has(
                    menu
                  );


                return (
                  <button
                    key={
                      menu
                    }
                    type="button"
                    onClick={() =>
                      toggleMenu(
                        menu
                      )
                    }
                    className={`flex min-h-12 items-center justify-between gap-2 rounded-2xl border px-3.5 py-3 text-left text-sm font-bold transition ${
                      selected
                        ? "border-orange-500 bg-orange-50 text-orange-600 shadow-sm"
                        : "border-gray-100 bg-gray-50 text-gray-700 hover:border-orange-200 hover:bg-orange-50/40"
                    }`}
                  >

                    <span className="min-w-0 leading-5">
                      {
                        menu
                      }
                    </span>


                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        selected
                          ? "bg-orange-500 text-white"
                          : "border border-gray-200 bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </span>

                  </button>
                );
              }
            )}

          </div>

        </section>


        {/* 현재 선택 */}
        <section className="mt-5 rounded-3xl bg-white p-5 shadow-sm">

          <div className="flex items-center justify-between">

            <div>
              <p className="text-xs font-extrabold text-gray-800">
                내가 고른 메뉴
              </p>

              <p className="mt-1 text-[11px] text-gray-400">
                ♡를 누르면 최애 ♥로 바뀌고 추천에 2배 가중치를 줘요.
              </p>
            </div>


            <span
              className={`text-xs font-extrabold ${
                selectedMenus.length >=
                MIN_DETAIL_PREFERENCES
                  ? "text-orange-500"
                  : "text-gray-400"
              }`}
            >
              {selectedMenus.length}개
            </span>

          </div>


          {selectedMenus.length ===
          0 ? (

            <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-5 text-center">

              <p className="text-xs text-gray-400">
                아직 선택한 세부 메뉴가 없어요.
              </p>

            </div>

          ) : (

            <div className="mt-4 flex flex-wrap gap-2">

              {selectedMenus.map(
                (
                  menu
                ) => {

                  const favorite =
                    favoriteMenuSet.has(
                      menu
                    );


                  return (
                    <div
                      key={
                        menu
                      }
                      className={`flex items-center overflow-hidden rounded-full border ${
                        favorite
                          ? "border-rose-200 bg-rose-50"
                          : "border-orange-100 bg-orange-50"
                      }`}
                    >

                      <button
                        type="button"
                        onClick={() =>
                          toggleFavoriteMenu(
                            menu
                          )
                        }
                        className={`flex items-center gap-1.5 py-2 pl-3 pr-2 text-xs font-bold transition ${
                          favorite
                            ? "text-rose-600"
                            : "text-orange-600"
                        }`}
                        title={
                          favorite
                            ? "최애 해제"
                            : "최애 메뉴로 표시"
                        }
                      >
                        <span>
                          {favorite
                            ? "♥"
                            : "♡"}
                        </span>

                        <span>
                          {menu}
                        </span>
                      </button>


                      <button
                        type="button"
                        onClick={() =>
                          removeSelectedMenu(
                            menu
                          )
                        }
                        className={`flex h-8 w-8 items-center justify-center border-l text-sm transition ${
                          favorite
                            ? "border-rose-100 text-rose-300 hover:bg-rose-100"
                            : "border-orange-100 text-orange-300 hover:bg-orange-100"
                        }`}
                        aria-label={`${menu} 선택 해제`}
                        title="선택 해제"
                      >
                        ×
                      </button>

                    </div>
                  );
                }
              )}

            </div>

          )}

        </section>


        {/* 상태 */}
        <div className="mt-5">

          {error ? (

            <div className="rounded-2xl bg-red-50 px-4 py-3 text-center text-xs font-semibold text-red-500">
              {error}
            </div>

          ) : selectedMenus.length <
            MIN_DETAIL_PREFERENCES ? (

            <div className="rounded-2xl bg-white px-4 py-3 text-center text-xs text-gray-400">
              앞으로{" "}
              <span className="font-extrabold text-orange-500">
                {
                  MIN_DETAIL_PREFERENCES -
                  selectedMenus.length
                }
                개
              </span>
              {" "}더 선택하면 저장할 수 있어요.
            </div>

          ) : selectedMenus.length >=
            30 ? (

            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-center text-xs font-semibold leading-5 text-amber-600">
              다양한 메뉴를 좋아하시네요! 선택이 많을수록 취향 범위가 넓어질 수 있어요.
              <br />
              특히 좋아하는 메뉴에는 ♥ 최애 표시를 해주세요.
            </div>

          ) : (

            <div className="rounded-2xl bg-orange-50 px-4 py-3 text-center text-xs font-bold text-orange-500">
              취향 분석 준비 완료 ✨
              {favoriteMenus.length > 0 && (
                <span className="ml-1">
                  · 최애 {favoriteMenus.length}개
                </span>
              )}
            </div>

          )}

        </div>


        {/* 하단 저장 */}
        <div className="fixed inset-x-0 bottom-0 z-30">

          <div className="mx-auto w-full max-w-md border-t border-gray-100 bg-[#faf8f5]/95 px-5 pb-5 pt-3 backdrop-blur">

            {error && (
              <div className="mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-center text-xs font-semibold text-red-500 shadow-sm">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={
                !canSave
              }
              onClick={
                savePreferences
              }
              className="w-full rounded-2xl bg-orange-500 py-4 text-sm font-extrabold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
            >
              {saving
                ? "취향을 분석하고 있어요..."
                : `선호도 저장하고 계속하기 · ${selectedMenus.length}개`}
            </button>

          </div>

        </div>

      </div>

    </main>
  );
}
