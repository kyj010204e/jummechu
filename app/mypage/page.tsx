"use client";

import {
  ChangeEvent,
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

const PROFILE_AVATARS = [
  {
    key: "chef",
    emoji: "👨‍🍳",
    name: "요리사",
    background: "bg-orange-100",
  },
  {
    key: "burger",
    emoji: "🍔",
    name: "버거",
    background: "bg-yellow-100",
  },
  {
    key: "pizza",
    emoji: "🍕",
    name: "피자",
    background: "bg-red-100",
  },
  {
    key: "noodle",
    emoji: "🍜",
    name: "면요리",
    background: "bg-amber-100",
  },
  {
    key: "sushi",
    emoji: "🍣",
    name: "초밥",
    background: "bg-pink-100",
  },
  {
    key: "coffee",
    emoji: "☕",
    name: "커피",
    background: "bg-stone-100",
  },
];

type User = {
  id: string;
  name: string;
  email: string;
  profileAvatarKey: string;
  profileImageUrl: string | null;
};

type MeResponse = {
  authenticated: boolean;
  user: User | null;
};

export default function MyPage() {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [showProfileModal, setShowProfileModal] =
    useState(false);

  const [profileLoading, setProfileLoading] =
    useState(false);

  const [showDeleteModal, setShowDeleteModal] =
    useState(false);

  const [deleteCode, setDeleteCode] =
    useState("");

  const [deleteCodeSent, setDeleteCodeSent] =
    useState(false);

  const [sendingDeleteCode, setSendingDeleteCode] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [deleteError, setDeleteError] =
    useState("");

  const [deleteInfo, setDeleteInfo] =
    useState("");

  /* =========================================================
     사용자 정보 조회
  ========================================================= */

  useEffect(() => {
    async function loadUser() {
      try {
        const response =
          await fetch(
            "/api/me",
            {
              cache: "no-store",
            }
          );

        const data =
          (await response.json()) as MeResponse;

        if (
          !response.ok ||
          !data.authenticated ||
          !data.user
        ) {
          router.replace("/login");
          return;
        }

        setUser(data.user);
      } catch (error) {
        console.error(
          "사용자 정보 조회 오류:",
          error
        );

        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [router]);

  /* =========================================================
     기본 프로필 선택
  ========================================================= */

  async function selectAvatar(
    avatarKey: string
  ) {
    try {
      setProfileLoading(true);

      const response =
        await fetch(
          "/api/profile",
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              avatarKey,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "프로필 변경에 실패했습니다."
        );
      }

      setUser(
        (current) =>
          current
            ? {
                ...current,
                profileAvatarKey:
                  avatarKey,
                profileImageUrl:
                  null,
              }
            : current
      );

      setShowProfileModal(false);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setProfileLoading(false);
    }
  }

  /* =========================================================
     직접 프로필 사진 업로드
  ========================================================= */

  async function uploadProfileImage(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setProfileLoading(true);

      const formData =
        new FormData();

      formData.append(
        "image",
        file
      );

      const response =
        await fetch(
          "/api/profile-image",
          {
            method: "POST",
            body: formData,
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "사진 업로드에 실패했습니다."
        );
      }

      setUser(
        (current) =>
          current
            ? {
                ...current,
                profileImageUrl:
                  data.profileImageUrl,
              }
            : current
      );

      setShowProfileModal(false);
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setProfileLoading(false);
      event.target.value = "";
    }
  }

  /* =========================================================
     로그아웃
  ========================================================= */

  async function handleLogout() {
    try {
      await fetch(
        "/api/logout",
        {
          method: "POST",
        }
      );

      localStorage.removeItem(
        "jummechu_user"
      );

      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error(
        "로그아웃 오류:",
        error
      );
    }
  }

  /* =========================================================
     회원탈퇴 이메일 인증
  ========================================================= */

  async function sendDeleteVerificationCode() {
    try {
      setSendingDeleteCode(true);
      setDeleteError("");
      setDeleteInfo("");

      const response =
        await fetch(
          "/api/account/delete-code",
          {
            method: "POST",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "인증메일 전송에 실패했습니다."
        );
      }

      setDeleteCodeSent(true);
      setDeleteCode("");
      setDeleteInfo(
        data.message ??
          "인증번호를 전송했습니다."
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "인증메일 전송 중 문제가 발생했습니다."
      );
    } finally {
      setSendingDeleteCode(false);
    }
  }

  async function handleDeleteAccount() {
    if (!/^\d{6}$/.test(deleteCode)) {
      setDeleteError(
        "이메일로 받은 6자리 인증번호를 입력해주세요."
      );
      return;
    }

    try {
      setDeleting(true);
      setDeleteError("");

      const response =
        await fetch(
          "/api/account/delete-confirm",
          {
            method: "DELETE",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              code: deleteCode,
            }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "회원탈퇴에 실패했습니다."
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
      localStorage.removeItem(
        "jummechu_location"
      );

      alert(
        "회원탈퇴가 완료되었습니다."
      );

      router.replace("/");
      router.refresh();
    } catch (error) {
      console.error(
        "회원탈퇴 오류:",
        error
      );

      setDeleteError(
        error instanceof Error
          ? error.message
          : "회원탈퇴 중 문제가 발생했습니다."
      );
    } finally {
      setDeleting(false);
    }
  }

  /* =========================================================
     로딩
  ========================================================= */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf8f5]">
        <p className="text-sm text-gray-400">
          사용자 정보를 불러오는 중...
        </p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const currentAvatar =
    PROFILE_AVATARS.find(
      (avatar) =>
        avatar.key ===
        user.profileAvatarKey
    ) ?? PROFILE_AVATARS[0];

  /* =========================================================
     UI
  ========================================================= */

  return (
    <>
      <main className="min-h-screen bg-[#faf8f5] px-5 py-7">
        <div className="mx-auto w-full max-w-md">
          {/* HEADER */}
          <header className="flex items-center justify-between">
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

            <h1 className="text-base font-extrabold text-gray-900">
              마이페이지
            </h1>

            <div className="h-9 w-9" />
          </header>

          {/* PROFILE */}
          <section className="mt-8 rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() =>
                  setShowProfileModal(true)
                }
                className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-full"
                aria-label="프로필 사진 변경"
              >
                {user.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt="프로필"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className={`flex h-full w-full items-center justify-center text-3xl ${currentAvatar.background}`}
                  >
                    {currentAvatar.emoji}
                  </div>
                )}

                <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-[10px] font-bold text-white opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                  변경
                </div>
              </button>

              <div className="ml-4 min-w-0 flex-1">
                <p className="truncate text-lg font-extrabold text-gray-900">
                  {user.name}
                </p>

                <p className="mt-1 truncate text-sm text-gray-400">
                  {user.email}
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setShowProfileModal(true)
                  }
                  className="mt-2 text-xs font-bold text-orange-500"
                >
                  프로필 변경
                </button>
              </div>
            </div>
          </section>

          {/* 계정 메뉴 */}
          <section className="mt-6">
            <p className="mb-3 text-xs font-bold text-gray-400">
              계정
            </p>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/preferences"
                  )
                }
                className="flex w-full items-center justify-between border-b border-gray-100 px-5 py-4 text-left transition hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    음식 취향 설정
                  </p>

                  <p className="mt-1 text-xs text-gray-400">
                    선호 메뉴를 변경해요.
                  </p>
                </div>

                <span className="text-gray-300">
                  ›
                </span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    로그아웃
                  </p>

                  <p className="mt-1 text-xs text-gray-400">
                    현재 계정에서 로그아웃합니다.
                  </p>
                </div>

                <span className="text-gray-300">
                  ›
                </span>
              </button>
            </div>
          </section>

          {/* 계정 관리 */}
          <section className="mt-8">
            <p className="mb-3 text-xs font-bold text-red-400">
              계정 관리
            </p>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-gray-800">
                    회원탈퇴
                  </p>

                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    계정과 저장된 취향,
                    위치 및 즐겨찾기 정보를
                    삭제합니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDeleteCode("");
                    setDeleteCodeSent(false);
                    setDeleteError("");
                    setDeleteInfo("");
                    setShowDeleteModal(true);
                  }}
                  className="shrink-0 rounded-xl bg-red-50 px-4 py-2.5 text-xs font-bold text-red-500 transition hover:bg-red-100"
                >
                  탈퇴
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* 프로필 선택 MODAL */}
      {showProfileModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">
                  프로필 설정
                </h2>

                <p className="mt-1 text-xs text-gray-400">
                  기본 프로필을 고르거나 직접 사진을 올려보세요.
                </p>
              </div>

              <button
                type="button"
                disabled={profileLoading}
                onClick={() =>
                  setShowProfileModal(false)
                }
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
                aria-label="프로필 설정 닫기"
              >
                ✕
              </button>
            </div>

            <p className="mt-6 text-xs font-bold text-gray-500">
              기본 프로필
            </p>

            <div className="mt-3 grid grid-cols-3 gap-3">
              {PROFILE_AVATARS.map(
                (avatar) => {
                  const selected =
                    !user.profileImageUrl &&
                    user.profileAvatarKey ===
                      avatar.key;

                  return (
                    <button
                      key={avatar.key}
                      type="button"
                      disabled={profileLoading}
                      onClick={() =>
                        selectAvatar(
                          avatar.key
                        )
                      }
                      className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl transition ${
                        selected
                          ? "border-2 border-orange-500 bg-orange-50"
                          : "border-2 border-transparent bg-gray-50 hover:border-orange-200"
                      }`}
                    >
                      {selected && (
                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                          ✓
                        </span>
                      )}

                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${avatar.background}`}
                      >
                        {avatar.emoji}
                      </div>

                      <span className="mt-2 text-[11px] font-semibold text-gray-600">
                        {avatar.name}
                      </span>
                    </button>
                  );
                }
              )}
            </div>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-[11px] text-gray-400">
                또는
              </span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>

            <label
              className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 ${
                profileLoading
                  ? "pointer-events-none opacity-50"
                  : ""
              }`}
            >
              <span>📷</span>
              {profileLoading
                ? "처리 중..."
                : "내 사진에서 선택"}

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={uploadProfileImage}
                className="hidden"
              />
            </label>

            <p className="mt-3 text-center text-[10px] text-gray-400">
              JPG, PNG, WEBP · 최대 5MB
            </p>
          </div>
        </div>
      )}

      {/* 회원탈퇴 MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">
                  정말 탈퇴하시겠어요?
                </h2>

                <p className="mt-2 text-sm leading-6 text-gray-500">
                  회원탈퇴 후에는
                  저장된 데이터를
                  복구할 수 없습니다.
                </p>
              </div>

              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  setShowDeleteModal(false)
                }
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 rounded-2xl bg-red-50 px-4 py-4">
              <p className="text-xs font-bold text-red-500">
                탈퇴하면 아래 정보가 삭제됩니다.
              </p>

              <div className="mt-3 space-y-1 text-xs leading-5 text-red-400">
                <p>• 계정 정보</p>
                <p>• 음식 선호도</p>
                <p>• 우리집 / 회사 등 저장 위치</p>
                <p>• 음식점 즐겨찾기</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-bold text-gray-700">
                이메일 본인 확인
              </p>

              <p className="mt-1 text-xs leading-5 text-gray-400">
                {user.email} 로 회원탈퇴 인증번호를 보내요.
              </p>

              <button
                type="button"
                disabled={
                  deleting ||
                  sendingDeleteCode
                }
                onClick={
                  sendDeleteVerificationCode
                }
                className="mt-3 w-full rounded-xl border border-red-100 bg-white py-3 text-xs font-bold text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sendingDeleteCode
                  ? "전송 중..."
                  : deleteCodeSent
                    ? "인증메일 다시 보내기"
                    : "인증메일 전송하기"}
              </button>
            </div>

            {deleteCodeSent && (
              <div className="mt-4">
                <label className="text-xs font-bold text-gray-600">
                  인증번호
                </label>

                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={deleteCode}
                  onChange={(event) => {
                    setDeleteCode(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 6)
                    );
                    setDeleteError("");
                  }}
                  placeholder="6자리 인증번호"
                  autoComplete="one-time-code"
                  disabled={deleting}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-center text-lg font-bold tracking-[0.3em] text-gray-800 outline-none transition focus:border-red-400"
                />
              </div>
            )}

            {deleteInfo && (
              <div className="mt-3 rounded-xl bg-green-50 px-4 py-3">
                <p className="text-xs text-green-600">
                  {deleteInfo}
                </p>
              </div>
            )}

            {deleteError && (
              <div className="mt-3 rounded-xl bg-red-50 px-4 py-3">
                <p className="text-xs text-red-500">
                  {deleteError}
                </p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  setShowDeleteModal(false)
                }
                className="flex-1 rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600"
              >
                취소
              </button>

              <button
                type="button"
                disabled={
                  deleting ||
                  !deleteCodeSent ||
                  !/^\d{6}$/.test(deleteCode)
                }
                onClick={handleDeleteAccount}
                className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting
                  ? "탈퇴 처리 중..."
                  : "회원탈퇴"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
