import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/session";
import { PROFILE_FILENAME, readProfileImage } from "@/lib/profile-files";

export const runtime = "nodejs";

// Runtime uploads cannot rely on Next's production public-folder file list.
export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
    const { filename } = await context.params;
    if (!PROFILE_FILENAME.test(filename)) return new Response(null, { status: 404 });
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { profile_image_url: true } });
    if (user?.profile_image_url !== `/api/profile-image/${filename}`) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(await readProfileImage(filename)), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
    console.error("PROFILE IMAGE READ ERROR:", error);
    return new Response(null, { status: 500 });
  }
}
