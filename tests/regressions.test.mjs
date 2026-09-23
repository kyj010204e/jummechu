import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dependencies = createRequire(path.join(process.env.JUMMECHU_DEPENDENCY_ROOT ?? root, "package.json"));
const ts = dependencies("typescript");
const jsonServer = { NextResponse: { json: (body, options) => Response.json(body, options) } };

// Execute the real handlers with isolated dependency doubles; never connect to a DB.
function load(relative, mocks = {}, cache = new Map()) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const testModule = { exports: {} };
  cache.set(filename, testModule);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === "next/server") return jsonServer;
    if (name === "@/lib/prisma") throw new Error("Tests must not connect to the real DB");
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts", mocks, cache);
    return dependencies(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(localRequire, testModule, testModule.exports);
  return testModule.exports;
}
const session = { getUserId: async () => BigInt(1) };
const noLimit = { rateLimit: () => null };
const request = (body, method = "PUT") => new Request("http://localhost/api/test", {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("coordinate validation rejects absent, blank, nonnumeric and out-of-range values", () => {
  const { parseCoordinate, parseId } = load("lib/validation.ts");
  for (const value of [null, undefined, "", " ", false, {}, "NaN", Infinity, 91, -91]) assert.equal(parseCoordinate(value, "latitude"), null);
  assert.equal(parseCoordinate("0", "latitude"), 0);
  assert.equal(parseCoordinate("127.3", "longitude"), 127.3);
  assert.equal(parseId("-1"), null);
  assert.equal(parseId("9223372036854775808"), null);
});

test("preferences reject unknown menu IDs and preserve data on invalid input", async () => {
  const handler = load("app/api/preferences/route.ts", {
    "@/lib/session": session, "@/lib/prisma": { prisma: { $transaction: () => assert.fail("must not write") } },
  });
  for (const values of [["korean", "pizza", "bogus"], ["korean", "korean", "pizza"], ["korean", {}, "pizza"]]) {
    assert.equal((await handler.PUT(request({ preferences: values }))).status, 400);
  }
});

test("preference replacement uses the authenticated user and a transaction", async () => {
  const calls = [];
  const handler = load("app/api/preferences/route.ts", {
    "@/lib/session": session,
    "@/lib/prisma": { prisma: { $transaction: async (work) => work({ user_preferences: {
      deleteMany: async (args) => calls.push(args), createMany: async (args) => calls.push(args),
    } }) } },
  });
  const response = await handler.PUT(request({ userId: "2", preferences: ["korean", "pizza", "meat"] }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { where: { user_id: BigInt(1) } });
  assert.ok(calls[1].data.every((row) => row.user_id === BigInt(1)));
});

test("saved location edits and deletes enforce ownership in the actual mutation", async () => {
  const calls = [];
  const route = load("app/api/saved-locations/[id]/route.ts", {
    "@/lib/session": session,
    "@/lib/prisma": { prisma: { saved_locations: {
      updateManyAndReturn: async (args) => { calls.push(args.where); return []; },
      deleteMany: async (args) => { calls.push(args.where); return { count: 0 }; },
    } } },
  });
  const context = { params: Promise.resolve({ id: "2" }) };
  assert.equal((await route.PATCH(request({ name: "남의 집" }, "PATCH"), context)).status, 404);
  assert.equal((await route.DELETE(request({}, "DELETE"), context)).status, 404);
  assert.deepEqual(calls, [{ id: BigInt(2), user_id: BigInt(1) }, { id: BigInt(2), user_id: BigInt(1) }]);
  assert.equal((await route.DELETE(request({}, "DELETE"), { params: Promise.resolve({ id: "bad" }) })).status, 400);
});

test("saved location creation rejects missing coordinates and oversized names", async () => {
  const route = load("app/api/saved-locations/route.ts", {
    "@/lib/session": session, "@/lib/prisma": { prisma: {} },
  });
  for (const body of [{ name: "집", longitude: 127 }, { name: "집", latitude: null, longitude: 127 }, { name: "집", latitude: 95, longitude: 127 }, { name: "a".repeat(101), latitude: 37, longitude: 127 }]) {
    assert.equal((await route.POST(request(body, "POST"))).status, 400);
  }
});

test("DB diagnostic API does not access or return user records", async () => {
  const response = await load("app/api/db-test/route.ts").GET();
  assert.equal(response.status, 404);
  assert.equal((await response.json()).users, undefined);
});

test("canonical account endpoint verifies password and removes the deleted user's image", async () => {
  const removed = [], cookies = [];
  let passwordMatches = false, deletes = 0;
  const route = load("app/api/account/route.ts", {
    "@/lib/session": session, "@/lib/rate-limit": noLimit,
    "@/lib/auth": { SESSION_COOKIE_NAME: "session" },
    "next/headers": { cookies: async () => ({ set: (...args) => cookies.push(args) }) },
    "bcryptjs": { compare: async () => passwordMatches },
    "@/lib/profile-files": { removeProfileImage: async (url) => removed.push(url) },
    "@/lib/prisma": { prisma: { users: {
      findUnique: async () => ({ password_hash: "hash" }),
      delete: async ({ where }) => { assert.equal(where.id, BigInt(1)); deletes++; return { profile_image_url: "/uploads/profile/old.png" }; },
    } } },
  });
  assert.equal((await route.DELETE(request({ password: "wrong" }, "DELETE"))).status, 401);
  assert.equal(deletes, 0);
  passwordMatches = true;
  assert.equal((await route.DELETE(request({ password: "correct" }, "DELETE"))).status, 200);
  assert.deepEqual(removed, ["/uploads/profile/old.png"]);
  assert.equal(cookies[0][2].maxAge, 0);
});

test("canonical session refresh extends a valid existing user's cookie for 14 days", async () => {
  const writes = [];
  const route = load("app/api/session/refresh/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "old" }), set: (...args) => writes.push(args) }) },
    "@/lib/auth": { SESSION_COOKIE_NAME: "session", SESSION_DURATION: 1209600, verifySessionToken: async () => ({ userId: "1" }), createSessionToken: async () => "renewed" },
    "@/lib/prisma": { prisma: { users: { findUnique: async () => ({ id: BigInt(1) }) } } },
  });
  assert.equal((await route.POST()).status, 200);
  assert.equal(writes[0][1], "renewed");
  assert.equal(writes[0][2].maxAge, 1209600);
  assert.equal(writes[0][2].httpOnly, true);
});

test("session refresh rejects a deleted account and clears its cookie", async () => {
  const writes = [];
  const route = load("app/api/session/refresh/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "old" }), set: (...args) => writes.push(args) }) },
    "@/lib/auth": { SESSION_COOKIE_NAME: "session", verifySessionToken: async () => ({ userId: "1" }), createSessionToken: () => assert.fail("must not renew") },
    "@/lib/prisma": { prisma: { users: { findUnique: async () => null } } },
  });
  assert.equal((await route.POST()).status, 401);
  assert.equal(writes[0][2].maxAge, 0);
});

test("JWT verification rejects expired, unsigned and non-session tokens", async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-never-used-in-production";
  try {
    const auth = load("lib/auth.ts");
    const { SignJWT } = dependencies("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const valid = await auth.createSessionToken("1");
    assert.deepEqual(await auth.verifySessionToken(valid), { userId: "1" });
    assert.equal(await auth.verifySessionToken(valid + "invalid"), null);
    for (const payload of [{ type: "other" }, { type: "session", exp: 1 }]) {
      const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setSubject("1").sign(secret);
      assert.equal(await auth.verifySessionToken(token), null);
    }
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous;
  }
});

test("images are decoded, resized and converted; forged MIME and corrupt bytes are rejected", async () => {
  const { prepareProfileImage } = load("lib/profile-files.ts");
  const sharp = dependencies("sharp");
  const png = await sharp({ create: { width: 1024, height: 512, channels: 3, background: "red" } }).png().toBuffer();
  const bytes = await prepareProfileImage(new File([png], "test.png", { type: "image/png" }));
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 256);
  assert.equal(meta.exif, undefined);
  await assert.rejects(prepareProfileImage(new File(["<svg></svg>"], "fake.png", { type: "image/png" })));
  await assert.rejects(prepareProfileImage(new File([], "empty.png", { type: "image/png" })));
});

test("profile file cleanup cannot escape the upload directory", async () => {
  const removed = [];
  const { removeProfileImage } = load("lib/profile-files.ts", { "node:fs/promises": { unlink: async (p) => removed.push(p) } });
  await removeProfileImage("/uploads/profile/../../.env");
  await removeProfileImage("https://example.com/private.png");
  assert.equal(removed.length, 0);
  await removeProfileImage("/uploads/profile/12345678-1234-1234-1234-123456789012.png");
  assert.equal(removed.length, 1);
  assert.equal(path.dirname(removed[0]), path.join(process.cwd(), "public", "uploads", "profile"));
});

test("concurrent profile changes remove the unused upload, never the winning image", async () => {
  const removed = [];
  const route = load("app/api/profile-image/route.ts", {
    "@/lib/session": session, "@/lib/rate-limit": noLimit,
    "@/lib/prisma": { prisma: { users: { findUnique: async () => ({ profile_image_url: "old" }), updateMany: async () => ({ count: 0 }) } } },
    "@/lib/profile-files": { prepareProfileImage: async () => Buffer.from("image"), saveProfileImage: async () => "unused", removeProfileImage: async (url) => removed.push(url) },
  });
  const form = new FormData();
  form.set("image", new File(["bytes"], "image.png", { type: "image/png" }));
  assert.equal((await route.POST(new Request("http://localhost/api/profile-image", { method: "POST", body: form }))).status, 409);
  assert.deepEqual(removed, ["unused"]);
});

test("uploaded images are served immediately only to the owning current profile", async () => {
  let storedUrl = "/api/profile-image/12345678-1234-1234-1234-123456789012.webp";
  let reads = 0;
  const route = load("app/api/profile-image/[filename]/route.ts", {
    "@/lib/session": session,
    "@/lib/prisma": { prisma: { users: { findUnique: async () => ({ profile_image_url: storedUrl }) } } },
    "@/lib/profile-files": { PROFILE_FILENAME: /^[a-f0-9-]{36}\.webp$/i, readProfileImage: async () => { reads++; return Buffer.from("image"); } },
  });
  const context = { params: Promise.resolve({ filename: "12345678-1234-1234-1234-123456789012.webp" }) };
  const response = await route.GET(new Request("http://localhost/api/profile-image/test"), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  storedUrl = null;
  assert.equal((await route.GET(new Request("http://localhost/api/profile-image/test"), context)).status, 404);
  assert.equal(reads, 1);
});

test("location search without a center does not silently use (0, 0)", async () => {
  const previousFetch = globalThis.fetch;
  const keys = ["NAVER_MAPS_CLIENT_ID", "NAVER_MAPS_CLIENT_SECRET", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = "test-value"; });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(String(url).includes("geocode") ? { addresses: [{ x: "127", y: "37", roadAddress: "서울", jibunAddress: "서울" }] } : { items: [] });
  };
  try {
    const route = load("app/api/location-search/route.ts", { "@/lib/rate-limit": noLimit });
    const response = await route.GET(new Request("http://localhost/api/location-search?query=test"));
    const data = await response.json();
    assert.equal(data.center, null);
    assert.equal(data.results[0].distance, null);
    assert.ok(urls.every((url) => !url.includes("coordinate=")));
    assert.equal((await route.GET(new Request("http://localhost/api/location-search?query=test&latitude=bad&longitude=127"))).status, 400);
    globalThis.fetch = async () => new Response("upstream unavailable", { status: 503 });
    assert.equal((await route.GET(new Request("http://localhost/api/location-search?query=test"))).status, 502);
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("restaurant search uses DB preferences, includes all nine and ignores browser-supplied preferences", async () => {
  const previousFetch = globalThis.fetch;
  const keys = ["NAVER_MAPS_CLIENT_ID", "NAVER_MAPS_CLIENT_SECRET", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key) => { process.env[key] = "test-value"; });
  const ids = load("lib/validation.ts").MENU_IDS;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json(String(url).includes("reversegeocode") ? { results: [{ name: "admcode", region: { area1: { name: "서울" } } }] } : { items: [] });
  };
  try {
    const route = load("app/api/restaurants/route.ts", {
      "@/lib/session": session, "@/lib/rate-limit": noLimit,
      "@/lib/prisma": { prisma: { user_preferences: { findMany: async ({ where }) => {
        assert.equal(where.user_id, BigInt(1)); return ids.map((menu_type) => ({ menu_type }));
      } } } },
    });
    const response = await route.GET(new Request("http://localhost/api/restaurants?latitude=37&longitude=127&preferences=WRONG"));
    assert.equal(response.status, 200);
    assert.equal(urls.length, 10);
    assert.equal((await response.json()).preferences.length, 9);
    assert.ok(urls.every((url) => !url.includes("WRONG")));
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test("rate limiter returns Retry-After and recovers when the window expires", () => {
  const now = Date.now;
  let time = 1000000;
  Date.now = () => time;
  try {
    const { rateLimit } = load("lib/rate-limit.ts");
    assert.equal(rateLimit("regression-limit", 1, 1000), null);
    const response = rateLimit("regression-limit", 1, 1000);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "1");
    time += 1001;
    assert.equal(rateLimit("regression-limit", 1, 1000), null);
  } finally { Date.now = now; }
});
