-- 점메추 - 회원탈퇴 이메일 인증번호
-- API에서도 CREATE TABLE IF NOT EXISTS로 자동 생성합니다.

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
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_codes_user
ON account_deletion_codes(user_id, created_at DESC);
