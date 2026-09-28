"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";


type ApiResponse = {
  success?: boolean;
  message?: string;
  verificationToken?: string;
  resendAfterSeconds?: number;
};


export default function ForgotPasswordPage() {
  const router =
    useRouter();

  const [email, setEmail] =
    useState("");

  const [code, setCode] =
    useState("");

  const [
    verificationToken,
    setVerificationToken,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    passwordConfirm,
    setPasswordConfirm,
  ] = useState("");

  const [
    codeSent,
    setCodeSent,
  ] = useState(false);

  const [
    verified,
    setVerified,
  ] = useState(false);

  const [
    finished,
    setFinished,
  ] = useState(false);

  const [
    resendSeconds,
    setResendSeconds,
  ] = useState(0);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    message,
    setMessage,
  ] = useState("");


  useEffect(() => {
    if (
      resendSeconds <= 0
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () => {
          setResendSeconds(
            (current) =>
              Math.max(
                0,
                current - 1
              )
          );
        },
        1000
      );

    return () =>
      window.clearInterval(
        timer
      );
  }, [resendSeconds]);


  function resetVerification() {
    setCode("");

    setVerificationToken(
      ""
    );

    setCodeSent(
      false
    );

    setVerified(
      false
    );

    setResendSeconds(
      0
    );

    setMessage("");

    setError("");
  }


  async function requestCode() {
    const normalizedEmail =
      email
        .trim()
        .toLowerCase();

    if (!normalizedEmail) {
      setError(
        "이메일을 입력해주세요."
      );

      return;
    }

    try {
      setLoading(true);

      setError("");

      setMessage("");

      const response =
        await fetch(
          "/api/email-verification/request",
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
                  normalizedEmail,

                purpose:
                  "password_reset",
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as ApiResponse;

      if (!response.ok) {
        if (
          response.status ===
            429 &&
          data.resendAfterSeconds
        ) {
          setResendSeconds(
            data.resendAfterSeconds
          );
        }

        throw new Error(
          data.message ??
            "인증번호 발송에 실패했습니다."
        );
      }

      setCodeSent(
        true
      );

      setResendSeconds(
        data.resendAfterSeconds ??
          60
      );

      setMessage(
        data.message ??
          "가입된 이메일이라면 인증번호를 발송했습니다."
      );

    } catch (requestError) {
      setError(
        requestError instanceof
          Error
          ? requestError.message
          : "인증번호 발송에 실패했습니다."
      );

    } finally {
      setLoading(false);
    }
  }


  async function verifyCode() {
    if (
      !/^\d{6}$/.test(
        code
      )
    ) {
      setError(
        "6자리 인증번호를 입력해주세요."
      );

      return;
    }

    try {
      setLoading(true);

      setError("");

      const response =
        await fetch(
          "/api/email-verification/verify",
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

                purpose:
                  "password_reset",

                code,
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as ApiResponse;

      if (
        !response.ok ||
        !data.verificationToken
      ) {
        throw new Error(
          data.message ??
            "이메일 인증에 실패했습니다."
        );
      }

      setVerificationToken(
        data.verificationToken
      );

      setVerified(
        true
      );

      setMessage(
        "이메일 인증이 완료되었습니다. 새 비밀번호를 입력해주세요."
      );

    } catch (verifyError) {
      setError(
        verifyError instanceof
          Error
          ? verifyError.message
          : "이메일 인증에 실패했습니다."
      );

    } finally {
      setLoading(false);
    }
  }


  async function resetPassword(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (
      password.length < 8
    ) {
      setError(
        "비밀번호는 8자 이상 입력해주세요."
      );

      return;
    }

    if (
      password !==
      passwordConfirm
    ) {
      setError(
        "비밀번호가 서로 일치하지 않습니다."
      );

      return;
    }

    try {
      setLoading(true);

      setError("");

      const response =
        await fetch(
          "/api/password-reset/confirm",
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

                verificationToken,
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as ApiResponse;

      if (!response.ok) {
        throw new Error(
          data.message ??
            "비밀번호 변경에 실패했습니다."
        );
      }

      setFinished(
        true
      );

      setMessage(
        data.message ??
          "비밀번호가 변경되었습니다."
      );

    } catch (resetError) {
      setError(
        resetError instanceof
          Error
          ? resetError.message
          : "비밀번호 변경에 실패했습니다."
      );

    } finally {
      setLoading(false);
    }
  }


  if (finished) {
    return (
      <main className="min-h-screen bg-[#faf8f5] px-5 py-7">

        <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center">

          <div className="w-full rounded-3xl bg-white p-7 text-center shadow-sm">

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl">
              ✓
            </div>

            <h1 className="mt-5 text-2xl font-extrabold text-gray-900">
              비밀번호 변경 완료
            </h1>

            <p className="mt-3 text-sm leading-6 text-gray-500">
              {message}
            </p>

            <button
              type="button"
              onClick={() =>
                router.replace(
                  "/login"
                )
              }
              className="mt-7 w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white"
            >
              로그인하러 가기
            </button>

          </div>

        </div>

      </main>
    );
  }


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


        <section className="mt-10">

          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-2xl">
            🔐
          </div>

          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-gray-900">
            비밀번호 찾기
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            가입한 이메일로 인증한 뒤
            <br />
            새 비밀번호를 설정할 수 있어요.
          </p>

        </section>


        <div className="mt-9 space-y-5">

          <div>

            <label className="text-sm font-bold text-gray-700">
              이메일
            </label>

            <div className="mt-2 flex gap-2">

              <input
                type="email"
                value={email}
                disabled={
                  verified
                }
                onChange={(event) => {
                  setEmail(
                    event.target.value
                  );

                  resetVerification();
                }}
                placeholder="example@email.com"
                autoComplete="email"
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-800 outline-none focus:border-orange-400 disabled:bg-gray-50"
              />

              <button
                type="button"
                disabled={
                  loading ||
                  verified ||
                  resendSeconds > 0
                }
                onClick={
                  requestCode
                }
                className="shrink-0 rounded-xl bg-orange-500 px-4 text-xs font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
              >
                {resendSeconds > 0
                  ? `${resendSeconds}초`
                  : codeSent
                    ? "재발송"
                    : "인증번호 받기"}
              </button>

            </div>

          </div>


          {codeSent &&
            !verified && (
              <div>

                <label className="text-sm font-bold text-gray-700">
                  인증번호
                </label>

                <div className="mt-2 flex gap-2">

                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(event) =>
                      setCode(
                        event.target.value
                          .replace(
                            /\D/g,
                            ""
                          )
                          .slice(
                            0,
                            6
                          )
                      )
                    }
                    placeholder="6자리 인증번호"
                    className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm tracking-[0.3em] outline-none focus:border-orange-400"
                  />

                  <button
                    type="button"
                    disabled={
                      loading ||
                      code.length !== 6
                    }
                    onClick={
                      verifyCode
                    }
                    className="shrink-0 rounded-xl bg-gray-900 px-5 text-xs font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    확인
                  </button>

                </div>

              </div>
            )}


          {message && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-600">
              {message}
            </div>
          )}


          {verified && (
            <form
              onSubmit={
                resetPassword
              }
              className="space-y-5"
            >

              <div>

                <label className="text-sm font-bold text-gray-700">
                  새 비밀번호
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
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm outline-none focus:border-orange-400"
                />

              </div>


              <div>

                <label className="text-sm font-bold text-gray-700">
                  새 비밀번호 확인
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
                  placeholder="새 비밀번호를 다시 입력해주세요"
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm outline-none focus:border-orange-400"
                />

              </div>


              <button
                type="submit"
                disabled={
                  loading
                }
                className="w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {loading
                  ? "변경 중..."
                  : "비밀번호 변경"}
              </button>

            </form>
          )}


          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-xs leading-5 text-red-500">
              {error}
            </div>
          )}

        </div>

      </div>

    </main>
  );
}
