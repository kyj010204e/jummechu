import os
from pathlib import Path
from urllib.parse import (
    urlparse,
    parse_qsl,
    urlencode,
    urlunparse,
)

import numpy as np
import psycopg

from dotenv import load_dotenv


# ============================================================
# 기본 설정
# ============================================================

PROJECT_ROOT = (
    Path(__file__).resolve().parent.parent
)

MODEL_NAME = (
    "intfloat/multilingual-e5-small"
)


# ============================================================
# 환경변수
# ============================================================

load_dotenv(
    PROJECT_ROOT / ".env"
)

load_dotenv(
    PROJECT_ROOT / ".env.local",
    override=True,
)

DATABASE_URL = os.getenv(
    "DATABASE_URL"
)

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL이 없습니다."
    )


# ============================================================
# Prisma schema 옵션 제거
# ============================================================

def clean_database_url(url):

    parsed = urlparse(url)

    query = [
        (key, value)
        for key, value in parse_qsl(
            parsed.query,
            keep_blank_values=True,
        )
        if key != "schema"
    ]

    return urlunparse(
        parsed._replace(
            query=urlencode(query)
        )
    )


DATABASE_URL = clean_database_url(
    DATABASE_URL
)


# ============================================================
# 벡터 정규화
# ============================================================

def normalize(vector):

    vector = np.array(
        vector,
        dtype=np.float32,
    )

    norm = np.linalg.norm(
        vector
    )

    if norm == 0:
        return vector

    return vector / norm


# ============================================================
# 사용자 목록
# ============================================================

def load_users(conn):

    sql = """
    SELECT DISTINCT user_id
    FROM user_preferences
    ORDER BY user_id;
    """

    with conn.cursor() as cur:

        cur.execute(sql)

        return [
            row[0]
            for row in cur.fetchall()
        ]


# ============================================================
# 사용자 선호 카테고리 + 벡터
# ============================================================

def load_user_preferences(
    conn,
    user_id,
):

    sql = """
    SELECT
        up.menu_type,
        pce.embedding
    FROM user_preferences up

    JOIN preference_category_embeddings pce
        ON pce.category = up.menu_type

    WHERE up.user_id = %s

    ORDER BY up.id;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (user_id,),
        )

        return cur.fetchall()


# ============================================================
# 사용자 취향 벡터 생성
# ============================================================

def make_user_vector(
    preference_rows,
):

    vectors = []

    for (
        category,
        embedding,
    ) in preference_rows:

        vector = normalize(
            embedding
        )

        vectors.append(
            vector
        )

    if not vectors:
        return None

    # 각 카테고리는 동일 비중
    user_vector = np.mean(
        vectors,
        axis=0,
    )

    # 평균낸 뒤 다시 정규화
    return normalize(
        user_vector
    )


# ============================================================
# DB 저장
# ============================================================

def save_user_embedding(
    conn,
    user_id,
    embedding,
    preference_count,
):

    vector = embedding.tolist()

    sql = """
    INSERT INTO user_taste_embeddings (
        user_id,
        embedding,
        embedding_dim,
        model_name,
        preference_count,
        updated_at
    )
    VALUES (
        %s,
        %s,
        %s,
        %s,
        %s,
        CURRENT_TIMESTAMP
    )

    ON CONFLICT (user_id)

    DO UPDATE SET

        embedding =
            EXCLUDED.embedding,

        embedding_dim =
            EXCLUDED.embedding_dim,

        model_name =
            EXCLUDED.model_name,

        preference_count =
            EXCLUDED.preference_count,

        updated_at =
            CURRENT_TIMESTAMP;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (
                user_id,
                vector,
                len(vector),
                MODEL_NAME,
                preference_count,
            ),
        )


# ============================================================
# 메인
# ============================================================

def main():

    print()
    print(
        "===================================="
    )
    print(
        "User Taste Embedding 생성"
    )
    print(
        "===================================="
    )
    print()

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        users = load_users(
            conn
        )

        print(
            f"선호정보 보유 사용자 : "
            f"{len(users)}명"
        )

        print()

        success_count = 0
        skip_count = 0

        for user_id in users:

            preference_rows = (
                load_user_preferences(
                    conn,
                    user_id,
                )
            )

            if not preference_rows:

                print(
                    f"user_id={user_id} "
                    f"→ 매칭 가능한 선호 없음"
                )

                skip_count += 1
                continue

            categories = [
                row[0]
                for row in preference_rows
            ]

            user_vector = (
                make_user_vector(
                    preference_rows
                )
            )

            if user_vector is None:

                skip_count += 1
                continue

            save_user_embedding(
                conn,
                user_id,
                user_vector,
                len(preference_rows),
            )

            success_count += 1

            print(
                f"user_id={user_id} "
                f"→ {', '.join(categories)} "
                f"→ 384차원 저장"
            )

        conn.commit()

    print()
    print(
        "===================================="
    )

    print(
        f"저장 완료 : "
        f"{success_count}명"
    )

    print(
        f"건너뜀   : "
        f"{skip_count}명"
    )

    print(
        "===================================="
    )


if __name__ == "__main__":
    main()