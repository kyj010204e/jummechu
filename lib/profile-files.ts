import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const directory = () => path.join(process.cwd(), "uploads", "profile");
export const PROFILE_FILENAME = /^[a-f0-9-]{36}\.webp$/i;

export async function prepareProfileImage(file: File) {
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("이미지는 0바이트보다 크고 5MB 이하여야 합니다.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPG, PNG, WEBP만 가능합니다.");
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new Error("Unsupported image");
    // Decode actual image data, strip EXIF/GPS, and bound stored dimensions.
    return await image.rotate().resize(512, 512, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new Error("유효한 JPG, PNG, WEBP 이미지가 아닙니다.");
  }
}

export async function saveProfileImage(bytes: Buffer) {
  const name = `${randomUUID()}.webp`;
  await mkdir(directory(), { recursive: true });
  await writeFile(path.join(directory(), name), bytes, { flag: "wx" });
  return `/api/profile-image/${name}`;
}

export async function readProfileImage(name: string) {
  if (!PROFILE_FILENAME.test(name)) throw new Error("Invalid profile filename");
  return readFile(path.join(directory(), name));
}

export async function removeProfileImage(url: string | null) {
  if (!url) return;
  const match = /^\/(uploads\/profile|api\/profile-image)\/([a-f0-9-]{36}\.(?:jpg|jpeg|png|webp))$/i.exec(url);
  if (!match) return;
  const parent = match[1] === "uploads/profile"
    ? path.join(process.cwd(), "public", "uploads", "profile") : directory();
  try {
    await unlink(path.join(parent, match[2]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("프로필 파일 정리 실패:", error);
  }
}
