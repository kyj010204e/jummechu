import Link from "next/link";

import SocialLoginButtons from "@/components/SocialLoginButtons";
import { AppShell } from "@/components/JummechuUI";

export default function Home() {
  return (
    <AppShell>
      <div className="flex min-h-screen flex-col px-5 pb-8 pt-10">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black tracking-[0.12em] text-orange-500">
              JUMMECHU
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-400">
              오늘 점심, 고민은 짧게
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500 text-xl shadow-lg shadow-orange-100">
            🍴
          </div>
        </div>

        <section className="mt-14">
          <p className="text-sm font-extrabold text-orange-500">
            내 취향과 거리를 함께 보는 점심 추천
          </p>

          <h1 className="mt-3 text-[34px] font-black leading-[1.18] tracking-[-0.04em] text-gray-950">
            오늘 점심,
            <br />
            뭐 먹지?
          </h1>

          <p className="mt-4 text-sm leading-6 text-gray-500">
            내가 좋아하는 메뉴와 지금 위치를 바탕으로
            <br />
            점심 후보를 빠르게 골라드려요.
          </p>
        </section>

        <section className="mt-8 overflow-hidden rounded-[30px] bg-[#0f172a] p-5 text-white shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black tracking-[0.08em] text-orange-300">
                SMART LUNCH MATCH
              </p>
              <h2 className="mt-2 text-xl font-black leading-7">
                취향은 더 정확하게,
                <br />
                선택은 더 간단하게
              </h2>
            </div>

            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-4xl">
              🍱
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {["취향 분석", "거리 반영", "친구 추천"].map((item) => (
              <div
                key={item}
                className="rounded-2xl bg-white/8 px-2 py-3 text-center text-[11px] font-bold text-white/80"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-auto pt-8">
          <div className="space-y-3">
            <Link
              href="/signup"
              className="flex w-full items-center justify-center rounded-2xl bg-orange-500 py-4 text-sm font-extrabold text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 active:scale-[0.99]"
            >
              이메일로 시작하기
            </Link>

            <Link
              href="/login"
              className="flex w-full items-center justify-center rounded-2xl border border-gray-200 bg-white py-4 text-sm font-extrabold text-gray-800 transition hover:bg-gray-50 active:scale-[0.99]"
            >
              로그인하기
            </Link>
          </div>

          <div className="my-5 flex items-center gap-4">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="shrink-0 text-[11px] font-semibold text-gray-400">
              간편 로그인
            </span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          <SocialLoginButtons />

          <p className="mt-5 text-center text-[11px] leading-5 text-gray-400">
            Google 또는 네이버 계정으로 빠르게 시작할 수 있어요.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
