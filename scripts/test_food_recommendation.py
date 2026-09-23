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
# 기본 설정
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(
    PROJECT_ROOT / ".env.local",
    override=True,
)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL이 없습니다."
    )


# ============================================================
# Prisma URL 옵션 제거
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

    norm = np.linalg.norm(vector)

    if norm == 0:
        return vector

    return vector / norm


# ============================================================
# 사용자가 선택한 음식 벡터 가져오기
# ============================================================

def load_preference_embeddings(
    conn,
    food_names,
):

    sql = """
    SELECT
        f.name,
        fe.embedding
    FROM foods f
    JOIN food_embeddings fe
        ON fe.food_id = f.id
    WHERE f.name = ANY(%s);
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (food_names,),
        )

        return cur.fetchall()


# ============================================================
# 전체 음식 임베딩 가져오기
# ============================================================

def load_all_embeddings(conn):

    sql = """
    SELECT
        f.id,
        f.name,
        f.cuisine_type,
        f.food_type,
        fe.embedding
    FROM foods f
    JOIN food_embeddings fe
        ON fe.food_id = f.id
    ORDER BY f.id;
    """

    with conn.cursor() as cur:

        cur.execute(sql)

        return cur.fetchall()


# ============================================================
# 추천
# ============================================================

def recommend(
    preference_rows,
    all_rows,
    selected_names,
    top_k=10,
):

    # ========================================================
    # 선호 음식 각각의 벡터 유지
    # ========================================================

    preference_vectors = []

    for name, embedding in preference_rows:

        preference_vectors.append({
            "name": name,
            "vector": normalize(
                embedding
            ),
        })

    # ========================================================
    # 모든 후보 음식 점수 계산
    # ========================================================

    candidates = []

    for (
        food_id,
        name,
        cuisine_type,
        food_type,
        embedding,
    ) in all_rows:

        # 사용자가 이미 선택한 음식 제외
        if name in selected_names:
            continue

        food_vector = normalize(
            embedding
        )

        similarities = []

        # ----------------------------------------------------
        # 각각의 선호 음식과 비교
        # ----------------------------------------------------

        for pref in preference_vectors:

            similarity = float(
                np.dot(
                    pref["vector"],
                    food_vector,
                )
            )

            similarities.append({
                "anchor": pref["name"],
                "similarity": similarity,
            })

        # 가장 비슷한 선호 음식
        best = max(
            similarities,
            key=lambda x: x["similarity"],
        )

        # 모든 선호 음식과의 평균
        mean_similarity = float(
            np.mean([
                item["similarity"]
                for item in similarities
            ])
        )

        # ----------------------------------------------------
        # 최종 메뉴 선호 점수
        #
        # 특정 취향과 강하게 맞는 정도 75%
        # 전체 취향과의 평균 25%
        # ----------------------------------------------------

        score = (
            best["similarity"] * 0.75
            + mean_similarity * 0.25
        )

        candidates.append({
            "id": food_id,
            "name": name,
            "cuisine_type": cuisine_type,
            "food_type": food_type,
            "embedding": food_vector,
            "score": score,
            "best_anchor": best["anchor"],
            "best_similarity": best["similarity"],
        })

    # 점수 높은 순
    candidates.sort(
        key=lambda x: x["score"],
        reverse=True,
    )

    # ========================================================
    # 하나의 취향으로 몰리는 것 제한
    # ========================================================

    results = []

    anchor_counts = {
        pref["name"]: 0
        for pref in preference_vectors
    }

    # 예:
    # 선호 음식 3개 / Top 10
    # → 한 선호 음식 기준 최대 4개
    max_per_anchor = max(
        2,
        (top_k // len(
            preference_vectors
        )) + 1,
    )

    for candidate in candidates:

        anchor = candidate[
            "best_anchor"
        ]

        if (
            anchor_counts[anchor]
            >= max_per_anchor
        ):
            continue

        results.append(
            candidate
        )

        anchor_counts[anchor] += 1

        if len(results) >= top_k:
            break

    return results


# ============================================================
# 메인
# ============================================================

def main():

    print()
    print(
        "===================================="
    )
    print(
        "점메추 음식 추천 테스트"
    )
    print(
        "===================================="
    )
    print()

    # ========================================================
    # 명령줄 음식 이름
    # ========================================================

    food_names = sys.argv[1:]

    if len(food_names) < 3:

        print(
            "좋아하는 음식을 "
            "3개 이상 입력해주세요."
        )

        print()

        print("예:")

        print(
            'python scripts\\'
            'test_food_recommendation.py '
            '"김치볶음밥" '
            '"육회비빔밥" '
            '"연어초밥"'
        )

        return

    print("선택 음식:")

    for name in food_names:
        print(
            f" - {name}"
        )

    print()

    # ========================================================
    # DB 연결
    # ========================================================

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        preference_rows = (
            load_preference_embeddings(
                conn,
                food_names,
            )
        )

        # ----------------------------------------------------
        # DB에 없는 음식 검사
        # ----------------------------------------------------

        found_names = {
            row[0]
            for row in preference_rows
        }

        missing_names = [
            name
            for name in food_names
            if name not in found_names
        ]

        if missing_names:

            print(
                "❌ DB에 없는 음식:"
            )

            for name in missing_names:
                print(
                    f" - {name}"
                )

            return

        # ----------------------------------------------------
        # 전체 음식
        # ----------------------------------------------------

        all_rows = (
            load_all_embeddings(
                conn
            )
        )

        # ----------------------------------------------------
        # 추천
        # ----------------------------------------------------

        results = recommend(
            preference_rows,
            all_rows,
            set(food_names),
            top_k=10,
        )

    # ========================================================
    # 결과 출력
    # ========================================================

    print(
        "===== 추천 TOP 10 ====="
    )

    print()

    for rank, item in enumerate(
        results,
        start=1,
    ):

        print(
            f"{rank:>2}. "
            f"{item['name']:<18} "
            f"점수 {item['score']:.3f} "
            f"| 기준: "
            f"{item['best_anchor']} "
            f"| "
            f"{item['cuisine_type'] or '-'} "
            f"| "
            f"{item['food_type'] or '-'}"
        )


# ============================================================
# 실행
# ============================================================

if __name__ == "__main__":
    main()