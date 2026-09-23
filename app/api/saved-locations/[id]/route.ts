import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { parseId, parseName } from "@/lib/validation";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const id = parseId((await context.params).id);
    const body = await request.json().catch(() => null);
    const name = parseName(body?.name);
    if (!id || !name) return NextResponse.json({ message: "올바른 위치 ID와 1~100자의 이름을 입력해주세요." }, { status: 400 });
    const updated = await prisma.saved_locations.updateManyAndReturn({ where: { id, user_id: userId }, data: { name } });
    const location = updated[0];
    if (!location) return NextResponse.json({ message: "저장된 위치를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, location: { id: location.id.toString(), name: location.name, latitude: location.latitude, longitude: location.longitude } });
  } catch (error) {
    console.error("PATCH SAVED LOCATION ERROR:", error);
    return NextResponse.json({ message: "위치 이름 변경 중 오류가 발생했습니다." }, { status: 500 });
  }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "올바른 위치 ID가 아닙니다." }, { status: 400 });
    const deleted = await prisma.saved_locations.deleteMany({ where: { id, user_id: userId } });
    if (!deleted.count) return NextResponse.json({ message: "저장된 위치를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, message: "저장 위치가 삭제되었습니다." });
  } catch (error) {
    console.error("DELETE SAVED LOCATION ERROR:", error);
    return NextResponse.json({ message: "위치 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
