import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { parsePreferences } from "@/lib/validation";

export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const preferences = await prisma.user_preferences.findMany({ where: { user_id: userId }, orderBy: { id: "asc" } });
    return NextResponse.json({ success: true, preferences: preferences.map((item) => item.menu_type) });
  } catch (error) {
    console.error("GET PREFERENCES ERROR:", error);
    return NextResponse.json({ message: "선호 메뉴를 불러오지 못했습니다." }, { status: 500 });
  }
}
export async function PUT(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const body = await request.json().catch(() => null);
    const preferences = parsePreferences(body?.preferences);
    if (!preferences || preferences.length < 3) return NextResponse.json({ message: "목록에 있는 선호 메뉴를 3개 이상 선택해주세요." }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      await tx.user_preferences.deleteMany({ where: { user_id: userId } });
      await tx.user_preferences.createMany({ data: preferences.map((menu_type) => ({ user_id: userId, menu_type })) });
    });
    return NextResponse.json({ success: true, preferences, message: "선호 메뉴가 저장되었습니다." });
  } catch (error) {
    console.error("PUT PREFERENCES ERROR:", error);
    return NextResponse.json({ message: "선호 메뉴 저장 중 오류가 발생했습니다." }, { status: 500 });
  }
}
