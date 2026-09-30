import { prisma } from "@/lib/prisma";

import {
  generateVerificationCode,
  hashVerificationCode,
  safeHashEquals,
  VERIFICATION_CODE_TTL_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_RESEND_MS,
} from "@/lib/email-verification";

import {
  sendVerificationCodeEmail,
} from "@/mailer";


type UserEmailRow = {
  email: string;
};


type LatestCodeRow = {
  id: bigint;
  code_hash: string;
  expires_at: Date;
  attempt_count: number;
  created_at: Date;
};


export class AccountDeletionError extends Error {
  status: number;

  constructor(
    message: string,
    status = 400
  ) {
    super(message);
    this.name = "AccountDeletionError";
    this.status = status;
  }
}


async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS account_deletion_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      code_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT account_deletion_codes_attempt_ck
        CHECK (
          attempt_count >= 0
          AND attempt_count <= 5
        )
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_account_deletion_codes_user
    ON account_deletion_codes(user_id, created_at DESC)
  `);
}


async function getUserEmail(
  userId: bigint
) {
  const rows =
    await prisma.$queryRaw<
      UserEmailRow[]
    >`
      SELECT email
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

  const email =
    rows[0]?.email
      ?.trim()
      .toLowerCase();

  if (!email) {
    throw new AccountDeletionError(
      "계정 이메일을 확인하지 못했습니다.",
      404
    );
  }

  return email;
}


export async function sendAccountDeletionCode(
  userId: bigint
) {
  await ensureTable();

  const email =
    await getUserEmail(userId);

  const recent =
    await prisma.$queryRaw<
      Array<{
        created_at: Date;
      }>
    >`
      SELECT created_at
      FROM account_deletion_codes
      WHERE
        user_id = ${userId}
        AND consumed_at IS NULL
        AND created_at >
          NOW() - INTERVAL '60 seconds'
      ORDER BY created_at DESC
      LIMIT 1
    `;

  if (recent[0]) {
    const elapsed =
      Date.now() -
      recent[0].created_at.getTime();

    const remainSeconds =
      Math.max(
        1,
        Math.ceil(
          (
            VERIFICATION_RESEND_MS -
            elapsed
          ) / 1000
        )
      );

    throw new AccountDeletionError(
      `${remainSeconds}초 후 다시 전송할 수 있습니다.`,
      429
    );
  }

  const code =
    generateVerificationCode();

  const codeHash =
    hashVerificationCode(
      email,
      "account_delete",
      code
    );

  const expiresAt =
    new Date(
      Date.now() +
      VERIFICATION_CODE_TTL_MS
    );

  const inserted =
    await prisma.$queryRaw<
      Array<{ id: bigint }>
    >`
      INSERT INTO account_deletion_codes
      (
        user_id,
        email,
        code_hash,
        expires_at,
        attempt_count,
        created_at
      )
      VALUES
      (
        ${userId},
        ${email},
        ${codeHash},
        ${expiresAt},
        0,
        CURRENT_TIMESTAMP
      )
      RETURNING id
    `;

  const rowId =
    inserted[0]?.id;

  try {
    await sendVerificationCodeEmail({
      to: email,
      code,
      purpose: "account_delete",
    });
  } catch (error) {
    if (rowId) {
      await prisma.$executeRaw`
        DELETE FROM account_deletion_codes
        WHERE id = ${rowId}
      `;
    }

    throw error;
  }

  return {
    email,
    expiresInSeconds:
      Math.floor(
        VERIFICATION_CODE_TTL_MS /
        1000
      ),
  };
}


export async function deleteAccountWithCode(
  userId: bigint,
  code: string
) {
  await ensureTable();

  if (!/^\d{6}$/.test(code)) {
    throw new AccountDeletionError(
      "6자리 인증번호를 입력해주세요."
    );
  }

  const email =
    await getUserEmail(userId);

  const rows =
    await prisma.$queryRaw<
      LatestCodeRow[]
    >`
      SELECT
        id,
        code_hash,
        expires_at,
        attempt_count,
        created_at
      FROM account_deletion_codes
      WHERE
        user_id = ${userId}
        AND email = ${email}
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

  const row = rows[0];

  if (!row) {
    throw new AccountDeletionError(
      "먼저 인증메일을 전송해주세요."
    );
  }

  if (
    row.expires_at.getTime() <
    Date.now()
  ) {
    throw new AccountDeletionError(
      "인증번호가 만료되었습니다. 다시 전송해주세요."
    );
  }

  if (
    row.attempt_count >=
    VERIFICATION_MAX_ATTEMPTS
  ) {
    throw new AccountDeletionError(
      "인증 시도 횟수를 초과했습니다. 인증메일을 다시 전송해주세요.",
      429
    );
  }

  const actualHash =
    hashVerificationCode(
      email,
      "account_delete",
      code
    );

  if (
    !safeHashEquals(
      row.code_hash,
      actualHash
    )
  ) {
    await prisma.$executeRaw`
      UPDATE account_deletion_codes
      SET attempt_count = attempt_count + 1
      WHERE id = ${row.id}
    `;

    throw new AccountDeletionError(
      "인증번호가 일치하지 않습니다."
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        UPDATE account_deletion_codes
        SET consumed_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id}
      `;

      const deleted =
        await tx.$executeRaw`
          DELETE FROM users
          WHERE id = ${userId}
        `;

      if (deleted !== 1) {
        throw new AccountDeletionError(
          "계정을 찾지 못했습니다.",
          404
        );
      }
    }
  );
}
