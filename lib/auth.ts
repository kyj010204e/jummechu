import {
  SignJWT,
  jwtVerify,
} from "jose";

const SESSION_COOKIE_NAME =
  "jummechu_session";

const SESSION_DURATION =
  60 * 60 * 24 * 14;

/* =========================================================
   SECRET
========================================================= */

function getSecret() {
  const secret =
    process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "SESSION_SECRET이 설정되지 않았습니다."
    );
  }

  return new TextEncoder().encode(
    secret
  );
}

/* =========================================================
   세션 생성
========================================================= */

export async function createSessionToken(
  userId: string
) {
  return await new SignJWT({
    type: "session",
  })
    .setProtectedHeader({
      alg: "HS256",
    })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(getSecret());
}

/* =========================================================
   세션 검증
========================================================= */

export async function verifySessionToken(
  token: string
) {
  try {
    const {
      payload,
    } = await jwtVerify(
      token,
      getSecret(),
      { algorithms: ["HS256"] }
    );

    if (!payload.sub || !/^[1-9]\d{0,18}$/.test(payload.sub) || payload.type !== "session" || typeof payload.exp !== "number") {
      return null;
    }

    return {
      userId:
        payload.sub,
    };
  } catch {
    return null;
  }
}

/* =========================================================
   COOKIE 정보
========================================================= */

export {
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
};