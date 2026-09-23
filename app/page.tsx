"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#faf8f5] px-5">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">

        {/* 상단 여백 */}
        <div className="flex-1" />

        {/* 로고 */}
        <section className="text-center">

          <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-[26px] bg-orange-500 shadow-lg shadow-orange-100">
            <span className="text-4xl">🍴</span>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
            오늘 점심 뭐 먹지?
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            결정 장애를 해결해주는
            <br />
            나만의 점심 추천 서비스
          </p>

        </section>

        {/* 음식 이미지 영역 */}
        <section className="my-10 overflow-hidden rounded-[28px] bg-orange-50">
          <div className="flex aspect-[4/3] items-center justify-center">
            <div className="text-center">

              <div className="text-8xl">
                🍱
              </div>

              <p className="mt-4 text-sm font-medium text-orange-600">
                오늘은 뭐 먹을까?
              </p>

            </div>
          </div>
        </section>

        {/* 버튼 */}
        <section className="space-y-3 pb-8">

          <button
            onClick={() => router.push("/signup")}
            className="w-full rounded-xl bg-orange-500 py-4 text-sm font-bold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 active:scale-[0.98]"
          >
            이메일로 시작하기
          </button>

          <button
            onClick={() => router.push("/login")}
            className="w-full rounded-xl border border-gray-200 bg-white py-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 active:scale-[0.98]"
          >
            로그인하기
          </button>

          <div className="flex items-center gap-4 py-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">
              간편 로그인
            </span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="flex justify-center gap-3">

            <button
              aria-label="카카오 로그인"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FEE500] text-lg"
            >
              💬
            </button>

            <button
              aria-label="네이버 로그인"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[#03C75A] text-lg text-white"
            >
              N
            </button>

            <button
              aria-label="Apple 로그인"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black text-lg text-white"
            >
              
            </button>

          </div>

        </section>

      </div>
    </main>
  );
}