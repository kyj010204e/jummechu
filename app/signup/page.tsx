"use client";

import {
  FormEvent,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type SignupResponse = {
  success: boolean;

  message?: string;

  user?: {
    id: string;
    name: string;
    email: string;
  };
};

export default function SignupPage() {
  const router =
    useRouter();

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    passwordConfirm,
    setPasswordConfirm,
  ] = useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  /* =======================================================
     회원가입
  ======================================================= */

  const handleSignup =
    async (
      event:
        FormEvent<HTMLFormElement>
    ) => {
      event.preventDefault();

      setError("");

      /* =========================
         프론트 검증
      ========================== */

      if (
        !name.trim() ||
        !email.trim() ||
        !password ||
        !passwordConfirm
      ) {
        setError(
          "모든 항목을 입력해주세요."
        );

        return;
      }

      if (
        password.length <
        8
      ) {
        setError(
          "비밀번호는 8자 이상이어야 합니다."
        );

        return;
      }

      if (
        password !==
        passwordConfirm
      ) {
        setError(
          "비밀번호가 일치하지 않습니다."
        );

        return;
      }

      try {
        setLoading(true);

        /* =========================
           서버 회원가입 API
        ========================== */

        const response =
          await fetch(
            "/api/signup",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  name:
                    name.trim(),

                  email:
                    email
                      .trim()
                      .toLowerCase(),

                  password,
                }),
            }
          );

        const data =
          (await response.json()) as SignupResponse;

        if (!response.ok) {
          throw new Error(
            data.message ??
              "회원가입에 실패했습니다."
          );
        }

        if (!data.user) {
          throw new Error(
            "회원 정보를 받아오지 못했습니다."
          );
        }

        localStorage.removeItem("jummechu_user");
        localStorage.removeItem("jummechu_preferences");
        localStorage.removeItem("jummechu_saved_locations");
        window.dispatchEvent(new Event("jummechu-authenticated"));

        /*
         * 취향 설정으로 이동
         */
        router.push(
          "/preferences"
        );
      } catch (error) {
        console.error(error);

        if (
          error instanceof Error
        ) {
          setError(
            error.message
          );
        } else {
          setError(
            "회원가입 중 문제가 발생했습니다."
          );
        }
      } finally {
        setLoading(false);
      }
    };

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

      <div className="mx-auto w-full max-w-md">

        {/* 뒤로가기 */}

        <button
          type="button"
          onClick={() =>
            router.back()
          }
          className="flex h-9 w-9 items-center justify-center text-2xl text-gray-700"
          aria-label="뒤로가기"
        >
          ‹
        </button>

        {/* 제목 */}

        <section className="mt-10">

          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-2xl">
            🍽️
          </div>

          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
            점메추 시작하기
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            계정을 만들고
            <br />
            나만의 점심 취향을 저장해보세요.
          </p>

        </section>

        {/* FORM */}

        <form
          onSubmit={
            handleSignup
          }
          className="mt-9 space-y-5"
        >

          {/* 이름 */}

          <div>

            <label className="text-sm font-bold text-gray-700">
              이름
            </label>

            <input
              type="text"
              value={name}
              onChange={(event) =>
                setName(
                  event.target.value
                )
              }
              placeholder="이름을 입력해주세요"
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>

          {/* 이메일 */}

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
              placeholder="example@email.com"
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>

          {/* 비밀번호 */}

          <div>

            <label className="text-sm font-bold text-gray-700">
              비밀번호
            </label>

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
              placeholder="8자 이상 입력해주세요"
              autoComplete="new-password"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>

          {/* 비밀번호 확인 */}

          <div>

            <label className="text-sm font-bold text-gray-700">
              비밀번호 확인
            </label>

            <input
              type="password"
              value={
                passwordConfirm
              }
              onChange={(event) =>
                setPasswordConfirm(
                  event.target.value
                )
              }
              placeholder="비밀번호를 다시 입력해주세요"
              autoComplete="new-password"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-orange-400"
            />

          </div>

          {/* 오류 */}

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3">

              <p className="text-xs leading-5 text-red-500">
                {error}
              </p>

            </div>
          )}

          {/* 회원가입 */}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            {loading
              ? "가입하는 중..."
              : "회원가입"}
          </button>

        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          이미 계정이 있나요?{" "}

          <button
            type="button"
            onClick={() =>
              router.push(
                "/login"
              )
            }
            className="font-bold text-orange-500"
          >
            로그인
          </button>

        </p>

      </div>

    </main>
  );
}