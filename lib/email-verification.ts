import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";


export type VerificationPurpose =
  | "signup"
  | "password_reset"
  | "account_delete";


export const VERIFICATION_CODE_TTL_MS =
  10 * 60 * 1000;

export const VERIFICATION_RESEND_MS =
  60 * 1000;

export const VERIFICATION_MAX_ATTEMPTS =
  5;


function getVerificationSecret() {
  const secret =
    process.env.EMAIL_VERIFICATION_SECRET ??
    process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "EMAIL_VERIFICATION_SECRET 또는 SESSION_SECRET가 필요합니다."
    );
  }

  return secret;
}


function hmac(value: string) {
  return createHmac(
    "sha256",
    getVerificationSecret()
  )
    .update(value)
    .digest("hex");
}


export function normalizeEmail(
  value: unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .trim()
    .toLowerCase();
}


export function isValidEmail(
  email: string
) {
  return (
    email.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  );
}


export function isVerificationPurpose(
  value: unknown
): value is VerificationPurpose {
  return (
    value === "signup" ||
    value === "password_reset" ||
    value === "account_delete"
  );
}


export function generateVerificationCode() {
  return randomInt(
    100000,
    1000000
  ).toString();
}


export function hashVerificationCode(
  email: string,
  purpose: VerificationPurpose,
  code: string
) {
  return hmac(
    `code:${purpose}:${email}:${code}`
  );
}


export function generateVerificationToken() {
  return randomBytes(32)
    .toString("base64url");
}


export function hashVerificationToken(
  email: string,
  purpose: VerificationPurpose,
  token: string
) {
  return hmac(
    `token:${purpose}:${email}:${token}`
  );
}


export function safeHashEquals(
  expectedHex: string,
  actualHex: string
) {
  try {
    const expected =
      Buffer.from(
        expectedHex,
        "hex"
      );

    const actual =
      Buffer.from(
        actualHex,
        "hex"
      );

    if (
      expected.length !==
      actual.length
    ) {
      return false;
    }

    return timingSafeEqual(
      expected,
      actual
    );
  } catch {
    return false;
  }
}
