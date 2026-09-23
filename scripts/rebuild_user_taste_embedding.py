import os
import sys

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
# 설정
# ============================================================

PROJECT_ROOT = (
    Path(__file__).resolve().parent.parent
)

MODEL_NAME = (
    "intfloat/multilingual-e5-small"
)

# 실제 메뉴 선호가 있을 때
# 초기 카테고리 취향 30%
# 실제 메뉴 취향 70%
CATEGORY_WEIGHT = 0.30
FOOD_WEIGHT = 0.70


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
# Prisma DATABASE_URL 옵션 제거
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
# 전체 음식 embedding 조회
#
# global mean 계산용
# ============================================================

def load_all_food_embeddings(
    conn,
):

    sql = """
    SELECT
        embedding
    FROM food_embeddings
    ORDER BY food_id;
    """

    with conn.cursor() as cur:

        cur.execute(sql)

        return cur.fetchall()


# ============================================================
# 전체 음식 중심(global mean)
#
# 모든 음식 임베딩에 공통적으로 들어 있는
# "음식이라는 일반적인 특징"을 제거하기 위해 사용
# ============================================================

def load_global_mean(
    conn,
):

    rows = load_all_food_embeddings(
        conn
    )

    if not rows:

        raise RuntimeError(
            "food_embeddings 데이터가 없습니다."
        )

    vectors = []

    for row in rows:

        embedding = row[0]

        vector = normalize(
            embedding
        )

        vectors.append(
            vector
        )

    global_mean = np.mean(
        vectors,
        axis=0,
    )

    return global_mean


# ============================================================
# 사용자 초기 카테고리 취향
# ============================================================

def load_category_preferences(
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
# 사용자 실제 메뉴 선호
# ============================================================

def load_food_preferences(
    conn,
    user_id,
):

    sql = """
    SELECT
        f.name,
        ufp.weight,
        ufp.source,
        fe.embedding
    FROM user_food_preferences ufp

    JOIN foods f
        ON f.id = ufp.food_id

    JOIN food_embeddings fe
        ON fe.food_id = f.id

    WHERE ufp.user_id = %s

    ORDER BY ufp.id;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (user_id,),
        )

        return cur.fetchall()


# ============================================================
# 벡터 중심 보정
#
# raw embedding
#     ↓
# normalize
#     ↓
# global_mean 제거
#     ↓
# normalize
# ============================================================

def center_vector(
    embedding,
    global_mean,
):

    vector = normalize(
        embedding
    )

    vector = (
        vector
        - global_mean
    )

    return normalize(
        vector
    )


# ============================================================
# 카테고리 취향 벡터 생성
# ============================================================

def make_category_vector(
    rows,
    global_mean,
):

    if not rows:
        return None

    vectors = []

    for (
        category,
        embedding,
    ) in rows:

        vector = center_vector(
            embedding,
            global_mean,
        )

        vectors.append(
            vector
        )

    if not vectors:
        return None

    centroid = np.mean(
        vectors,
        axis=0,
    )

    return normalize(
        centroid
    )


# ============================================================
# 실제 음식 취향 벡터 생성
#
# weight를 반영한 weighted average
# ============================================================

def make_food_vector(
    rows,
    global_mean,
):

    if not rows:
        return None

    weighted_vectors = []

    total_weight = 0.0

    for (
        name,
        weight,
        source,
        embedding,
    ) in rows:

        weight = float(
            weight
        )

        # 현재는 좋아하는 음식만 취향 벡터 생성에 사용
        if weight <= 0:
            continue

        vector = center_vector(
            embedding,
            global_mean,
        )

        weighted_vectors.append(
            vector * weight
        )

        total_weight += weight

    if (
        not weighted_vectors
        or total_weight <= 0
    ):
        return None

    centroid = (
        np.sum(
            weighted_vectors,
            axis=0,
        )
        / total_weight
    )

    return normalize(
        centroid
    )


# ============================================================
# 최종 사용자 취향 벡터
# ============================================================

def make_final_vector(
    category_vector,
    food_vector,
):

    # --------------------------------------------------------
    # 초기 카테고리 + 실제 선호 메뉴 모두 존재
    # --------------------------------------------------------

    if (
        category_vector is not None
        and food_vector is not None
    ):

        combined = (
            category_vector
            * CATEGORY_WEIGHT
            +
            food_vector
            * FOOD_WEIGHT
        )

        return normalize(
            combined
        )

    # --------------------------------------------------------
    # 실제 음식 선호만 존재
    # --------------------------------------------------------

    if food_vector is not None:

        return normalize(
            food_vector
        )

    # --------------------------------------------------------
    # 초기 카테고리만 존재
    # --------------------------------------------------------

    if category_vector is not None:

        return normalize(
            category_vector
        )

    return None


# ============================================================
# 사용자 취향 embedding 저장
# ============================================================

def save_user_vector(
    conn,
    user_id,
    vector,
    preference_count,
):

    embedding = (
        vector.tolist()
    )

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
                embedding,
                len(embedding),
                MODEL_NAME,
                preference_count,
            ),
        )


# ============================================================
# 사용자 존재 확인
# ============================================================

def user_exists(
    conn,
    user_id,
):

    sql = """
    SELECT 1
    FROM users
    WHERE id = %s;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (user_id,),
        )

        return (
            cur.fetchone()
            is not None
        )


# ============================================================
# 사용자 한 명 재계산
# ============================================================

def rebuild_user(
    conn,
    user_id,
):

    # --------------------------------------------------------
    # 사용자 확인
    # --------------------------------------------------------

    if not user_exists(
        conn,
        user_id,
    ):

        print()
        print(
            f"❌ user_id={user_id}가 "
            f"존재하지 않습니다."
        )

        return False

    # --------------------------------------------------------
    # 음식 전체 중심
    # --------------------------------------------------------

    global_mean = (
        load_global_mean(
            conn
        )
    )

    # --------------------------------------------------------
    # 초기 카테고리
    # --------------------------------------------------------

    category_rows = (
        load_category_preferences(
            conn,
            user_id,
        )
    )

    # --------------------------------------------------------
    # 실제 선호 메뉴
    # --------------------------------------------------------

    food_rows = (
        load_food_preferences(
            conn,
            user_id,
        )
    )

    # --------------------------------------------------------
    # 각 취향 벡터 생성
    # --------------------------------------------------------

    category_vector = (
        make_category_vector(
            category_rows,
            global_mean,
        )
    )

    food_vector = (
        make_food_vector(
            food_rows,
            global_mean,
        )
    )

    # --------------------------------------------------------
    # 최종 벡터
    # --------------------------------------------------------

    final_vector = (
        make_final_vector(
            category_vector,
            food_vector,
        )
    )

    if final_vector is None:

        print()
        print(
            f"❌ user_id={user_id}: "
            f"사용 가능한 취향 데이터가 없습니다."
        )

        return False

    # --------------------------------------------------------
    # 카운트
    # --------------------------------------------------------

    category_count = len(
        category_rows
    )

    food_count = len(
        food_rows
    )

    preference_count = (
        category_count
        + food_count
    )

    # --------------------------------------------------------
    # 저장
    # --------------------------------------------------------

    save_user_vector(
        conn,
        user_id,
        final_vector,
        preference_count,
    )

    # ========================================================
    # 결과 출력
    # ========================================================

    print()
    print(
        "===================================="
    )

    print(
        f"user_id = {user_id}"
    )

    print()

    print(
        "카테고리 선호:"
    )

    if category_rows:

        for (
            category,
            _,
        ) in category_rows:

            print(
                f" - {category}"
            )

    else:

        print(
            " - 없음"
        )

    print()

    print(
        "실제 메뉴 선호:"
    )

    if food_rows:

        for (
            name,
            weight,
            source,
            _,
        ) in food_rows:

            print(
                f" - {name} "
                f"(weight={weight}, "
                f"source={source})"
            )

    else:

        print(
            " - 없음"
        )

    print()

    # --------------------------------------------------------
    # 가중치 출력
    # --------------------------------------------------------

    if (
        category_vector is not None
        and food_vector is not None
    ):

        print(
            "최종 비중:"
        )

        print(
            f" 카테고리 "
            f"{CATEGORY_WEIGHT:.0%}"
        )

        print(
            f" 실제 메뉴 "
            f"{FOOD_WEIGHT:.0%}"
        )

    elif food_vector is not None:

        print(
            "최종 비중:"
        )

        print(
            " 실제 메뉴 100%"
        )

    else:

        print(
            "최종 비중:"
        )

        print(
            " 카테고리 100%"
        )

    print()

    print(
        "중심 보정:"
    )

    print(
        " global_mean 제거 적용 ✅"
    )

    print()

    print(
        f"카테고리 수 : "
        f"{category_count}"
    )

    print(
        f"실제 메뉴 수 : "
        f"{food_count}"
    )

    print(
        f"전체 취향 수 : "
        f"{preference_count}"
    )

    print()

    print(
        f"Embedding 차원: "
        f"{len(final_vector)}"
    )

    print()

    print(
        "✅ 사용자 취향 벡터 갱신 완료"
    )

    print(
        "===================================="
    )

    return True


# ============================================================
# 메인
# ============================================================

def main():

    # --------------------------------------------------------
    # user_id 입력 확인
    # --------------------------------------------------------

    if len(sys.argv) < 2:

        print()
        print(
            "user_id를 입력해주세요."
        )

        print()

        print(
            "예:"
        )

        print(
            "python scripts\\"
            "rebuild_user_taste_embedding.py 1"
        )

        return

    try:

        user_id = int(
            sys.argv[1]
        )

    except ValueError:

        print()
        print(
            "❌ user_id는 숫자여야 합니다."
        )

        return

    # --------------------------------------------------------
    # DB 연결
    # --------------------------------------------------------

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        success = (
            rebuild_user(
                conn,
                user_id,
            )
        )

        if success:

            conn.commit()


# ============================================================
# 실행
# ============================================================

if __name__ == "__main__":
    main()