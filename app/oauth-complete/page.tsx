"use client";

import {
  useEffect,
  useState,
} from "react";

import Link from "next/link";

import {
  useRouter,
} from "next/navigation";


export default function OAuthCompletePage() {
  const router =
    useRouter();

  const [
    error,
    setError,
  ] =
    useState("");


  useEffect(() => {
    const params =
      new URLSearchParams(
        window.location.search
      );


    const errorMessage =
      params.get(
        "error"
      );


    if (
      errorMessage
    ) {
      setError(
        errorMessage
      );

      return;
    }


    const requestedNext =
      params.get(
        "next"
      );


    const next =
      requestedNext ===
        "/preferences"
        ? "/preferences"
        : "/map";


    /*
     * 기존 이메일 로그인/회원가입과 동일하게
     * 계정별로 남을 수 있는 로컬 캐시를 정리합니다.
     */
    localStorage.removeItem(
      "jummechu_user"
    );

    localStorage.removeItem(
      "jummechu_preferences"
    );

    localStorage.removeItem(
      "jummechu_saved_locations"
    );


    window.dispatchEvent(
      new Event(
        "jummechu-authenticated"
      )
    );


    router.replace(
      next
    );

    router.refresh();

  }, [
    router,
  ]);


  if (
    error
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf8f5] px-5">

        <section className="w-full max-w-sm rounded-3xl border border-red-100 bg-white p-6 text-center shadow-sm">

          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">
            !
          </div>

          <h1 className="mt-4 text-lg font-black text-gray-900">
            간편 로그인에 실패했어요
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            {error}
          </p>


          <div className="mt-6 grid grid-cols-2 gap-2">

            <Link
              href="/"
              className="rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600"
            >
              처음으로
            </Link>

            <Link
              href="/login"
              className="rounded-xl bg-orange-500 py-3 text-sm font-bold text-white"
            >
              로그인
            </Link>

          </div>

        </section>

      </main>
    );
  }


  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf8f5] px-5">

      <div className="text-center">

        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-orange-500" />

        <p className="mt-4 text-sm font-semibold text-gray-500">
          로그인 정보를 확인하고 있어요...
        </p>

      </div>

    </main>
  );
}
