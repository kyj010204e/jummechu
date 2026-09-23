import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { prepareProfileImage, saveProfileImage, removeProfileImage } from "@/lib/profile-files";
import { rateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let newImageUrl: string | null = null;
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const limited = rateLimit("profile-upload", 10, 60_000, userId.toString());
    if (limited) return limited;
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { profile_image_url: true } });
    if (!user) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    // Bound the entire multipart body even if Content-Length is absent.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ message: "이미지를 선택해주세요." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 6 * 1024 * 1024) {
        await reader.cancel();
        return NextResponse.json({ message: "업로드 용량을 초과했습니다." }, { status: 413 });
      }
      chunks.push(value);
    }
    let bytes: Buffer;
    try {
      const formData = await new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData();
      const file = formData.get("image");
      if (!(file instanceof File)) throw new Error("이미지를 선택해주세요.");
      bytes = await prepareProfileImage(file);
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "올바른 이미지가 아닙니다." }, { status: 400 });
    }
    newImageUrl = await saveProfileImage(bytes);
    const updated = await prisma.users.updateMany({
      where: { id: userId, profile_image_url: user.profile_image_url },
      data: { profile_image_url: newImageUrl },
    });
    if (!updated.count) {
      await removeProfileImage(newImageUrl);
      return NextResponse.json({ message: "프로필이 변경됐습니다. 다시 시도해주세요." }, { status: 409 });
    }
    const imageUrl = newImageUrl;
    newImageUrl = null;
    await removeProfileImage(user.profile_image_url);
    return NextResponse.json({ success: true, profileImageUrl: imageUrl });
  } catch (error) {
    await removeProfileImage(newImageUrl);
    console.error("PROFILE IMAGE ERROR:", error);
    return NextResponse.json({ message: "프로필 사진 업로드에 실패했습니다." }, { status: 500 });
  }
}
