import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type Bucket = { count: number; expiresAt: number };
const state = globalThis as typeof globalThis & { jummechuLimits?: Map<string, Bucket> };
const buckets = state.jummechuLimits ??= new Map<string, Bucket>();

// Per-process protection; multiple server replicas require a shared store.
export function rateLimit(scope: string, limit: number, windowMs: number, identity = "global") {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.expiresAt <= now) buckets.delete(key);
  const key = `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 10_000) return NextResponse.json({ message: "잠시 후 다시 시도해주세요." }, { status: 429, headers: { "Retry-After": "60" } });
    bucket = { count: 0, expiresAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) return NextResponse.json({ success: false, message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, {
    status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))) },
  });
  bucket.count++;
  return null;
}
