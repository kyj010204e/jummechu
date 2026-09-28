"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";


type LoginResponse = {
  success: boolean;
  message?: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
};


export default function LoginPage() {
  const router =
    useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");


  const handleLogin =
    async (
      event:
        FormEvent<HTMLFormElement>
    ) => {
      event.preventDefault();

      setError("");

      if (
        !email.trim() ||
        !password
      ) {
        setError(
          "이메일과 비밀번호를 입력해주세요."
        );

        return;
      }

      try {
        setLoading(true);

        const response =
          await fetch(
            "/api/login",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  email:
                    email
                      .trim()
                      .toLowerCase(),

                  password,
                }),
            }
          );

        const data =
          (
            await response.json()
          ) as LoginResponse;

        if (!response.ok) {
          throw new Error(
            data.message ??
              "로그인에 실패했습니다."
          );
        }

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
          "/map"
        );

      } catch (loginError) {
        setError(
          loginError instanceof
            Error
            ? loginError.message
            : "로그인 중 문제가 발생했습니다."
        );

      } finally {
        setLoading(false);
      }
    };


  return (
    <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

      <div className="mx-auto w-full max-w-md">

        <button
          type="button"
          onClick={() =>
            router.back()
          }
          className="flex h-9 w-9 items-center justify-center text-2xl text-gray-700"
          aria-label="뒤로가기"
        >
          ←
        </button>


        <section className="mt-12">

          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-2xl">
            🍽️
          </div>

          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
            다시 만났네요!
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            로그인하고
            <br />
            오늘의 점심 추천을 확인해보세요.
          </p>

        </section>


        <form
          onSubmit={
            handleLogin
          }
          className="mt-10 space-y-5"
        >

          <div>

            <label className="text-sm font-bold text-gray-700">
              이메일
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              autoComplete="email"
              placeholder="example@email.com"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>


          <div>

            <div className="flex items-center justify-between">

              <label className="text-sm font-bold text-gray-700">
                비밀번호
              </label>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/forgot-password"
                  )
                }
                className="text-xs font-bold text-orange-500"
              >
                비밀번호를 잊으셨나요?
              </button>

            </div>

            <input
              type="password"
              value={
                password
              }
              onChange={(event) =>
                setPassword(
                  event.target.value
                )
              }
              autoComplete="current-password"
              placeholder="비밀번호를 입력해주세요"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>


          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3">

              <p className="text-xs leading-5 text-red-500">
                {error}
              </p>

            </div>
          )}


          <button
            type="submit"
            disabled={
              loading
            }
            className="w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            {loading
              ? "로그인 중..."
              : "로그인"}
          </button>

        </form>


        <p className="mt-6 text-center text-xs text-gray-400">
          아직 계정이 없나요?{" "}

          <button
            type="button"
            onClick={() =>
              router.push(
                "/signup"
              )
            }
            className="font-bold text-orange-500"
          >
            회원가입
          </button>

        </p>

      </div>

    </main>
  );
}
