import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";


type AdminUserRow = {
  id: bigint;
  name: string | null;
  email: string;
  role: string;
};


type CountRow = {
  count: bigint;
};


async function getAdminUser() {
  const userId =
    await getUserId();

  if (!userId) {
    redirect(
      "/login"
    );
  }


  const rows =
    await prisma.$queryRaw<
      AdminUserRow[]
    >`
      SELECT
        id,
        name,
        email,
        role

      FROM users

      WHERE
        id = ${userId}

      LIMIT 1
    `;


  const user =
    rows[0];


  if (
    !user ||
    user.role !==
      "admin"
  ) {
    redirect(
      "/map"
    );
  }


  return user;
}


async function getPendingCounts() {
  try {
    const [
      businessHoursRows,
      priceRows,
    ] =
      await Promise.all([
        prisma.$queryRaw<
          CountRow[]
        >`
          SELECT
            COUNT(*)::bigint
              AS count

          FROM business_hours_reports

          WHERE
            status =
              'pending'
        `,

        prisma.$queryRaw<
          CountRow[]
        >`
          SELECT
            COUNT(*)::bigint
              AS count

          FROM price_reports

          WHERE
            status =
              'pending'
        `,
      ]);


    return {
      businessHours:
        Number(
          businessHoursRows[0]
            ?.count ??
          0
        ),

      priceReports:
        Number(
          priceRows[0]
            ?.count ??
          0
        ),
    };


  } catch (
    error
  ) {
    console.error(
      "Admin dashboard count error:",
      error
    );


    /*
     * 아직 일부 관리 테이블이 없는 개발환경에서도
     * 관리자 메인 화면 자체는 열리도록 합니다.
     */
    return {
      businessHours:
        0,

      priceReports:
        0,
    };
  }
}


export default async function AdminPage() {
  const user =
    await getAdminUser();

  const pending =
    await getPendingCounts();


  const adminMenus = [
    {
      href:
        "/admin/business-hours",

      emoji:
        "🕒",

      title:
        "영업시간 제보 관리",

      description:
        "사용자가 제보한 영업시간과 휴무일을 검토하고 승인 또는 반려합니다.",

      badge:
        pending.businessHours >
        0
          ? `${pending.businessHours}건 대기`
          : "대기 없음",

      badgeActive:
        pending.businessHours >
        0,
    },

    {
      href:
        "/admin/price-reports",

      emoji:
        "💰",

      title:
        "가격 제보 관리",

      description:
        "사용자가 제보한 실제 메뉴 가격을 검토하고 가격 DB에 반영합니다.",

      badge:
        pending.priceReports >
        0
          ? `${pending.priceReports}건 대기`
          : "대기 없음",

      badgeActive:
        pending.priceReports >
        0,
    },

    {
      href:
        "/admin/place-import",

      emoji:
        "📋",

      title:
        "플레이스 정보 반영",

      description:
        "네이버 플레이스에서 직접 복사한 텍스트를 분석해 영업시간과 메뉴 가격을 반영합니다.",

      badge:
        "수동 가져오기",

      badgeActive:
        false,
    },
  ] as const;


  return (
    <main className="min-h-screen bg-[#fffaf5] px-4 py-8">

      <div className="mx-auto w-full max-w-3xl">

        {/* ===================================================
            HEADER
        =================================================== */}

        <div className="flex flex-wrap items-start justify-between gap-4">

          <div>

            <p className="text-xs font-black tracking-[0.16em] text-orange-500">
              JUMMECHU ADMIN
            </p>

            <h1 className="mt-2 text-3xl font-black text-gray-900">
              관리자 센터
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              점메추 운영에 필요한 기능을 한 곳에서 관리해요.
            </p>

          </div>


          <Link
            href="/map"
            className="rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-gray-600 shadow-sm transition hover:bg-orange-50 hover:text-orange-600"
          >
            ← 지도
          </Link>

        </div>


        {/* ===================================================
            ADMIN INFO
        =================================================== */}

        <section className="mt-6 rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">

          <div className="flex items-center gap-3">

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-xl">
              👑
            </div>

            <div className="min-w-0">

              <p className="text-xs font-bold text-orange-500">
                관리자 로그인
              </p>

              <p className="mt-0.5 truncate text-sm font-black text-gray-800">
                {
                  user.name ||
                  user.email
                }
              </p>

            </div>

          </div>

        </section>


        {/* ===================================================
            MENU
        =================================================== */}

        <section className="mt-7">

          <div className="flex items-end justify-between gap-3">

            <div>

              <p className="text-xs font-bold text-gray-400">
                관리 기능
              </p>

              <h2 className="mt-1 text-xl font-black text-gray-900">
                무엇을 관리할까요?
              </h2>

            </div>


            <span className="text-xs font-semibold text-gray-300">
              {adminMenus.length}개
            </span>

          </div>


          <div className="mt-4 grid gap-3 sm:grid-cols-2">

            {adminMenus.map(
              (
                item
              ) => (
                <Link
                  key={
                    item.href
                  }
                  href={
                    item.href
                  }
                  className="group rounded-3xl border border-orange-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
                >

                  <div className="flex items-start justify-between gap-3">

                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-2xl transition group-hover:bg-orange-100">
                      {
                        item.emoji
                      }
                    </div>


                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        item.badgeActive
                          ? "bg-red-50 text-red-500"
                          : "bg-gray-50 text-gray-400"
                      }`}
                    >
                      {
                        item.badge
                      }
                    </span>

                  </div>


                  <h3 className="mt-4 text-base font-black text-gray-900">
                    {
                      item.title
                    }
                  </h3>

                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    {
                      item.description
                    }
                  </p>


                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">

                    <span className="text-xs font-bold text-orange-500">
                      관리하기
                    </span>

                    <span className="text-sm font-black text-orange-400 transition group-hover:translate-x-1">
                      →
                    </span>

                  </div>

                </Link>
              )
            )}

          </div>

        </section>


        {/* ===================================================
            QUICK STATUS
        =================================================== */}

        <section className="mt-7 rounded-3xl bg-gray-900 p-5 text-white">

          <p className="text-xs font-bold text-orange-300">
            현재 검토 대기
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">

            <Link
              href="/admin/business-hours"
              className="rounded-2xl bg-white/10 p-4 transition hover:bg-white/15"
            >

              <p className="text-2xl font-black">
                {
                  pending.businessHours
                }
              </p>

              <p className="mt-1 text-xs font-semibold text-white/60">
                영업시간 제보
              </p>

            </Link>


            <Link
              href="/admin/price-reports"
              className="rounded-2xl bg-white/10 p-4 transition hover:bg-white/15"
            >

              <p className="text-2xl font-black">
                {
                  pending.priceReports
                }
              </p>

              <p className="mt-1 text-xs font-semibold text-white/60">
                가격 제보
              </p>

            </Link>

          </div>

        </section>

      </div>

    </main>
  );
}
