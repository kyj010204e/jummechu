-- ============================================================
-- 점메추 - 소셜 로그인 계정 연결
-- Google / NAVER / Kakao
-- ============================================================

BEGIN;


CREATE TABLE IF NOT EXISTS
oauth_accounts (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    provider VARCHAR(20) NOT NULL,

    provider_user_id VARCHAR(255) NOT NULL,

    provider_email VARCHAR(255),

    provider_name VARCHAR(100),

    provider_profile_image_url TEXT,

    last_login_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT oauth_accounts_provider_ck
        CHECK (
            provider IN (
                'google',
                'naver',
                'kakao'
            )
        ),

    CONSTRAINT oauth_accounts_provider_user_uq
        UNIQUE (
            provider,
            provider_user_id
        ),

    CONSTRAINT oauth_accounts_user_provider_uq
        UNIQUE (
            user_id,
            provider
        )
);


CREATE INDEX IF NOT EXISTS
idx_oauth_accounts_user
ON oauth_accounts(
    user_id
);


CREATE INDEX IF NOT EXISTS
idx_oauth_accounts_email
ON oauth_accounts(
    LOWER(provider_email)
);


COMMENT ON TABLE oauth_accounts IS
'Links Jummechu users to Google, NAVER, and Kakao OAuth identities.';


COMMIT;


SELECT
    provider,
    COUNT(*) AS account_count

FROM oauth_accounts

GROUP BY
    provider

ORDER BY
    provider;
