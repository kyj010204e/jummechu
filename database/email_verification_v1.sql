-- =========================================================
-- 점메추 - 이메일 인증 / 비밀번호 재설정 v1
-- =========================================================
--
-- purpose:
--   signup         회원가입 이메일 인증
--   password_reset 비밀번호 재설정 이메일 인증
--
-- 인증번호 원문은 DB에 저장하지 않습니다.
-- code_hash는 서버 비밀키로 HMAC-SHA256 처리한 값입니다.
-- verification_token_hash 역시 원문 토큰을 저장하지 않습니다.
-- =========================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS
    email_verified_at TIMESTAMPTZ;


-- 기존 계정은 이미 정상적으로 사용 중이므로
-- migration 적용 시 인증 완료 상태로 유지합니다.
UPDATE users
SET email_verified_at = NOW()
WHERE email_verified_at IS NULL;


CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGSERIAL PRIMARY KEY,

    email VARCHAR(255) NOT NULL,

    purpose VARCHAR(32) NOT NULL,

    code_hash CHAR(64) NOT NULL,

    verification_token_hash CHAR(64),

    expires_at TIMESTAMPTZ NOT NULL,

    attempt_count INTEGER NOT NULL DEFAULT 0,

    verified_at TIMESTAMPTZ,

    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT email_verification_codes_purpose_ck
        CHECK (
            purpose IN (
                'signup',
                'password_reset'
            )
        ),

    CONSTRAINT email_verification_codes_attempt_ck
        CHECK (
            attempt_count >= 0
            AND attempt_count <= 5
        )
);


CREATE INDEX IF NOT EXISTS
    idx_email_verification_lookup
ON email_verification_codes (
    email,
    purpose,
    created_at DESC
);


CREATE INDEX IF NOT EXISTS
    idx_email_verification_token
ON email_verification_codes (
    verification_token_hash
)
WHERE verification_token_hash IS NOT NULL;


CREATE INDEX IF NOT EXISTS
    idx_email_verification_cleanup
ON email_verification_codes (
    expires_at
);


COMMENT ON TABLE email_verification_codes IS
'One-time email verification codes for signup and password reset.';


-- 선택: 오래된 인증 기록 정리용
-- DELETE FROM email_verification_codes
-- WHERE created_at < NOW() - INTERVAL '30 days';
