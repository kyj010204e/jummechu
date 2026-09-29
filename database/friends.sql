BEGIN;

/*
 * 이전 Supabase/UUID 실험 때 만들어진 친구 테이블이 남아 있으면
 * 현재 BIGINT users.id 구조와 충돌할 수 있습니다.
 *
 * 친구 기능은 아직 초기 단계이므로 친구 관련 테이블만 초기화합니다.
 */
DROP TABLE IF EXISTS friend_recommendation_sessions CASCADE;
DROP TABLE IF EXISTS recommendation_sessions CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;


/* =========================================================
   친구 관계
========================================================= */
CREATE TABLE friendships (
    id BIGSERIAL PRIMARY KEY,

    requester_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    receiver_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'ACCEPTED',
                'REJECTED'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (requester_id <> receiver_id)
);


CREATE UNIQUE INDEX uq_friendships_pair
ON friendships (
    LEAST(requester_id, receiver_id),
    GREATEST(requester_id, receiver_id)
);


CREATE INDEX idx_friendships_requester
ON friendships(requester_id);


CREATE INDEX idx_friendships_receiver
ON friendships(receiver_id);


/* =========================================================
   친구 공통메뉴 추천 세션
========================================================= */
CREATE TABLE friend_recommendation_sessions (
    id BIGSERIAL PRIMARY KEY,

    requester_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    friend_id BIGINT NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'ACCEPTED',
                'REJECTED',
                'COMPLETED'
            )
        ),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    rejected_at TIMESTAMP,
    completed_at TIMESTAMP,

    CHECK (requester_id <> friend_id)
);


CREATE UNIQUE INDEX uq_friend_recommendation_pending_pair
ON friend_recommendation_sessions (
    LEAST(requester_id, friend_id),
    GREATEST(requester_id, friend_id)
)
WHERE status = 'PENDING';


CREATE INDEX idx_friend_recommendation_requester
ON friend_recommendation_sessions(requester_id);


CREATE INDEX idx_friend_recommendation_friend
ON friend_recommendation_sessions(friend_id);

COMMIT;
