import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { removeProfileImage } from "@/lib/profile-files";
const AVATARS = ["chef", "burger", "pizza", "noodle", "sushi", "coffee"];
export async function PATCH(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json().catch(() => null);
    if (typeof body?.avatarKey !== "string" || !AVATARS.includes(body.avatarKey)) return NextResponse.json({ message: "사용할 수 없는 프로필입니다." }, { status: 400 });
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { profile_image_url: true } });
    if (!user) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const updated = await prisma.users.updateMany({
      where: { id: userId, profile_image_url: user.profile_image_url },
      data: { profile_avatar_key: body.avatarKey, profile_image_url: null },
    });
    if (!updated.count) return NextResponse.json({ message: "프로필이 변경됐습니다. 다시 시도해주세요." }, { status: 409 });
    await removeProfileImage(user.profile_image_url);
    return NextResponse.json({ success: true, profileAvatarKey: body.avatarKey, profileImageUrl: null });
  } catch (error) {
    console.error("PROFILE UPDATE ERROR:", error);
    return NextResponse.json({ message: "프로필 변경에 실패했습니다." }, { status: 500 });
  }
}
