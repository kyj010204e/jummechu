import math
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

CANDIDATE_POOL_SIZE = 100
TOP_K = 20


# ------------------------------------------------------------
# 대표 사용자 취향 vs 실제 선호 메뉴
# ------------------------------------------------------------

PROFILE_WEIGHT = 0.60
BEST_ANCHOR_WEIGHT = 0.30
MEAN_ANCHOR_WEIGHT = 0.10


# ------------------------------------------------------------
# MMR
#
# 높을수록 취향 적합도 우선
# 낮을수록 다양성 우선
# ------------------------------------------------------------

MMR_LAMBDA = 0.70


# ------------------------------------------------------------
# 동일 메뉴 계열 최대 추천 개수
# ------------------------------------------------------------

MAX_PER_FAMILY = 2


# ------------------------------------------------------------
# 최소 취향 점수
#
# 최고 후보 점수의 50%
# 또는 0.30 중 더 높은 값을 사용
# ------------------------------------------------------------

ABSOLUTE_MIN_SCORE = 0.30
RELATIVE_MIN_RATIO = 0.50


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

    norm = np.linalg.norm(
        vector
    )

    if norm == 0:
        return vector

    return vector / norm


# ============================================================
# 사용자 정보
# ============================================================

def load_user(
    conn,
    user_id,
):

    sql = """
    SELECT
        u.id,
        u.email,
        ute.embedding,
        ute.embedding_dim,
        ute.preference_count,
        ute.model_name

    FROM users u

    JOIN user_taste_embeddings ute
        ON ute.user_id = u.id

    WHERE u.id = %s;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (user_id,),
        )

        return cur.fetchone()


# ============================================================
# 초기 카테고리 취향
# ============================================================

def load_category_preferences(
    conn,
    user_id,
):

    sql = """
    SELECT
        menu_type

    FROM user_preferences

    WHERE user_id = %s

    ORDER BY id;
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (user_id,),
        )

        return [
            row[0]
            for row in cur.fetchall()
        ]


# ============================================================
# 실제 선호 메뉴
#
# 음식 embedding까지 같이 가져온다.
# ============================================================

def load_selected_foods(
    conn,
    user_id,
):

    sql = """
    SELECT
        f.id,
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
# 전체 음식
# ============================================================

def load_foods(
    conn,
):

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
# 음식 전체 평균 벡터
#
# 음식 임베딩들이 공통으로 가지고 있는
# "음식이라는 일반적인 특징" 제거용
# ============================================================

def make_global_mean(
    food_rows,
):

    vectors = []

    for (
        food_id,
        name,
        cuisine_type,
        food_type,
        embedding,
    ) in food_rows:

        vector = normalize(
            embedding
        )

        vectors.append(
            vector
        )

    if not vectors:

        raise RuntimeError(
            "food_embeddings 데이터가 없습니다."
        )

    return np.mean(
        vectors,
        axis=0,
    )


# ============================================================
# 음식 벡터 중심 보정
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
# 음식 계열 분류
#
# 추천 다양성 제어용
# DB 데이터는 변경하지 않는다.
# ============================================================

def get_food_family(
    name,
    food_type,
):

    # --------------------------------------------------------
    # 밥 계열
    # --------------------------------------------------------

    if "초밥" in name:
        return "초밥"

    if "김밥" in name:
        return "김밥"

    if "비빔밥" in name:
        return "비빔밥"

    if "볶음밥" in name:
        return "볶음밥"

    if "덮밥" in name:
        return "덮밥"

    if "국밥" in name:
        return "국밥"


    # --------------------------------------------------------
    # 면 계열
    # --------------------------------------------------------

    if "라면" in name:
        return "라면"

    if "냉면" in name:
        return "냉면"

    if "우동" in name:
        return "우동"

    if "칼국수" in name:
        return "칼국수"

    if (
        "국수" in name
        or "쫄면" in name
        or "짬뽕" in name
        or "자장" in name
    ):
        return "면류"


    # --------------------------------------------------------
    # 육류 / 패스트푸드
    # --------------------------------------------------------

    if (
        "치킨" in name
        or "닭튀김" in name
    ):
        return "치킨"

    if (
        "돈가스" in name
        or "돈까스" in name
    ):
        return "돈가스"

    if "버거" in name:
        return "버거"

    if "피자" in name:
        return "피자"


    # --------------------------------------------------------
    # 국물 / 조리 방식
    # --------------------------------------------------------

    if "찌개" in name:
        return "찌개"

    if "전골" in name:
        return "전골"

    if "국" in name:
        return "국"

    if "탕" in name:
        return "탕"

    if "구이" in name:
        return "구이"

    if "튀김" in name:
        return "튀김"

    if "볶음" in name:
        return "볶음"

    if "조림" in name:
        return "조림"

    if "찜" in name:
        return "찜"

    if "전" in name:
        return "전"

    if "무침" in name:
        return "무침"

    if "죽" in name:
        return "죽"

    if "떡" in name:
        return "떡"


    # --------------------------------------------------------
    # DB food_type fallback
    # --------------------------------------------------------

    return (
        food_type
        or "기타"
    )


# ============================================================
# 실제 선호 메뉴 각각을 anchor로 생성
# ============================================================

def make_preference_anchors(
    selected_foods,
    global_mean,
):

    anchors = []

    for (
        food_id,
        name,
        weight,
        source,
        embedding,
    ) in selected_foods:

        vector = center_vector(
            embedding,
            global_mean,
        )

        anchors.append({
            "id": food_id,
            "name": name,
            "weight": float(weight),
            "vector": vector,
        })

    return anchors


# ============================================================
# 1차 후보 생성
#
# 대표 사용자 취향
# +
# 개별 실제 선호 메뉴와의 유사도
# ============================================================

def make_candidate_pool(
    user_embedding,
    food_rows,
    selected_food_ids,
    anchors,
    global_mean,
):

    # --------------------------------------------------------
    # user_taste_embeddings는 이미
    # rebuild 과정에서 중심 보정되어 있음
    # --------------------------------------------------------

    user_vector = normalize(
        user_embedding
    )

    candidates = []


    # ========================================================
    # 모든 음식 평가
    # ========================================================

    for (
        food_id,
        name,
        cuisine_type,
        food_type,
        embedding,
    ) in food_rows:

        # ----------------------------------------------------
        # 이미 사용자가 좋아한다고 등록한 음식 제외
        # ----------------------------------------------------

        if food_id in selected_food_ids:
            continue


        # ----------------------------------------------------
        # 음식 중심 보정
        # ----------------------------------------------------

        food_vector = center_vector(
            embedding,
            global_mean,
        )


        # ----------------------------------------------------
        # 대표 사용자 취향과의 유사도
        # ----------------------------------------------------

        profile_similarity = float(
            np.dot(
                user_vector,
                food_vector,
            )
        )


        # ----------------------------------------------------
        # 실제 선호 음식들과 비교
        # ----------------------------------------------------

        if anchors:

            anchor_scores = []

            for anchor in anchors:

                similarity = float(
                    np.dot(
                        anchor["vector"],
                        food_vector,
                    )
                )

                anchor_scores.append({
                    "name":
                        anchor["name"],

                    "similarity":
                        similarity,
                })


            # 가장 유사한 실제 선호 메뉴
            best_anchor = max(
                anchor_scores,
                key=lambda item:
                    item["similarity"],
            )


            # 모든 실제 선호 메뉴와의 평균
            mean_anchor_similarity = float(
                np.mean([
                    item["similarity"]
                    for item in anchor_scores
                ])
            )


            best_anchor_name = (
                best_anchor["name"]
            )

            best_anchor_similarity = (
                best_anchor["similarity"]
            )


        else:

            # 실제 메뉴 선호가 없다면
            # 대표 취향 점수만 사용
            best_anchor_name = None

            best_anchor_similarity = (
                profile_similarity
            )

            mean_anchor_similarity = (
                profile_similarity
            )


        # ----------------------------------------------------
        # 최종 1차 취향 점수
        #
        # 대표 사용자 취향   60%
        # 가장 가까운 메뉴   30%
        # 전체 메뉴 평균     10%
        # ----------------------------------------------------

        base_score = (
            PROFILE_WEIGHT
            * profile_similarity

            + BEST_ANCHOR_WEIGHT
            * best_anchor_similarity

            + MEAN_ANCHOR_WEIGHT
            * mean_anchor_similarity
        )


        candidates.append({

            "id":
                food_id,

            "name":
                name,

            "cuisine_type":
                cuisine_type,

            "food_type":
                food_type,

            "family":
                get_food_family(
                    name,
                    food_type,
                ),

            "vector":
                food_vector,

            "profile_similarity":
                profile_similarity,

            "best_anchor":
                best_anchor_name,

            "anchor_similarity":
                best_anchor_similarity,

            "mean_anchor_similarity":
                mean_anchor_similarity,

            "base_score":
                base_score,
        })


    # ========================================================
    # 취향 점수 높은 순
    # ========================================================

    candidates.sort(
        key=lambda item:
            item["base_score"],
        reverse=True,
    )


    if not candidates:
        return []


    # ========================================================
    # 너무 취향에서 먼 음식 제거
    #
    # 예:
    #
    # 최고 점수 = 0.70
    #
    # 0.70 * 0.50 = 0.35
    #
    # 절대 기준 0.30보다 높으므로
    # 최소 점수 = 0.35
    # ========================================================

    best_score = (
        candidates[0][
            "base_score"
        ]
    )

    relative_min_score = (
        best_score
        * RELATIVE_MIN_RATIO
    )

    min_score = max(
        ABSOLUTE_MIN_SCORE,
        relative_min_score,
    )


    filtered = [
        candidate
        for candidate in candidates
        if (
            candidate["base_score"]
            >= min_score
        )
    ]


    # ========================================================
    # 후보 최대 100개
    # ========================================================

    return filtered[
        :CANDIDATE_POOL_SIZE
    ]


# ============================================================
# MMR 다양성 재랭킹
# ============================================================

def rerank_with_mmr(
    candidates,
    anchors,
    top_k,
):

    if not candidates:
        return []

    remaining = list(
        candidates
    )

    results = []

    family_counts = {}

    anchor_counts = {}


    # ========================================================
    # 1. 실제 선호 메뉴별 최소 1개 우선 확보
    # ========================================================

    if anchors:

        for anchor in anchors:

            available = [
                candidate
                for candidate in remaining
                if (
                    candidate["best_anchor"]
                    == anchor["name"]
                )
            ]

            if not available:
                continue

            best = max(
                available,
                key=lambda item:
                    item["anchor_similarity"],
            )

            family = (
                best["family"]
            )

            # 같은 계열 최대 개수
            if (
                family_counts.get(
                    family,
                    0,
                )
                >= MAX_PER_FAMILY
            ):
                continue

            best = dict(
                best
            )

            best["mmr_score"] = (
                best["base_score"]
            )

            results.append(
                best
            )

            family_counts[
                family
            ] = (
                family_counts.get(
                    family,
                    0,
                )
                + 1
            )

            anchor_counts[
                anchor["name"]
            ] = (
                anchor_counts.get(
                    anchor["name"],
                    0,
                )
                + 1
            )

            remaining = [
                item
                for item in remaining
                if item["id"]
                != best["id"]
            ]

            if len(results) >= top_k:
                return results


    # ========================================================
    # 2. Anchor 하나가 추천 전체를 독식하지 않도록 제한
    # ========================================================

    if anchors:

        max_per_anchor = max(
            3,
            math.ceil(
                top_k
                / len(anchors)
            ),
        )

    else:

        max_per_anchor = (
            top_k
        )


    # ========================================================
    # 3. MMR 다양성 재랭킹
    # ========================================================

    while (
        remaining
        and len(results) < top_k
    ):

        best_candidate = None

        best_mmr_score = (
            float("-inf")
        )

        for candidate in remaining:

            family = (
                candidate["family"]
            )

            anchor = (
                candidate["best_anchor"]
            )


            # ------------------------------------------------
            # 같은 음식 계열 제한
            # ------------------------------------------------

            if (
                family_counts.get(
                    family,
                    0,
                )
                >= MAX_PER_FAMILY
            ):
                continue


            # ------------------------------------------------
            # 특정 취향 anchor 독식 방지
            # ------------------------------------------------

            if (
                anchor
                and anchor_counts.get(
                    anchor,
                    0,
                )
                >= max_per_anchor
            ):
                continue


            # ------------------------------------------------
            # 기존 추천들과의 중복도
            # ------------------------------------------------

            if not results:

                redundancy = 0.0

            else:

                redundancy = max(
                    float(
                        np.dot(
                            candidate["vector"],
                            selected["vector"],
                        )
                    )
                    for selected
                    in results
                )


            # ------------------------------------------------
            # MMR
            # ------------------------------------------------

            mmr_score = (
                MMR_LAMBDA
                * candidate["base_score"]

                -

                (
                    1.0
                    - MMR_LAMBDA
                )
                * redundancy
            )


            if (
                mmr_score
                > best_mmr_score
            ):

                best_mmr_score = (
                    mmr_score
                )

                best_candidate = (
                    candidate
                )


        # 조건 만족 후보가 더 이상 없으면
        # MMR 단계 종료
        if best_candidate is None:
            break


        best_candidate = dict(
            best_candidate
        )

        best_candidate[
            "mmr_score"
        ] = best_mmr_score

        results.append(
            best_candidate
        )


        # ----------------------------------------------------
        # 계열 카운트
        # ----------------------------------------------------

        family = (
            best_candidate["family"]
        )

        family_counts[
            family
        ] = (
            family_counts.get(
                family,
                0,
            )
            + 1
        )


        # ----------------------------------------------------
        # Anchor 카운트
        # ----------------------------------------------------

        anchor = (
            best_candidate[
                "best_anchor"
            ]
        )

        if anchor:

            anchor_counts[
                anchor
            ] = (
                anchor_counts.get(
                    anchor,
                    0,
                )
                + 1
            )


        # ----------------------------------------------------
        # 선택된 후보 제거
        # ----------------------------------------------------

        remaining = [
            item
            for item in remaining
            if item["id"]
            != best_candidate["id"]
        ]


    # ========================================================
    # 4. FALLBACK
    #
    # 엄격한 다양성 조건 때문에 TOP_K가 안 찼으면
    # 남은 후보 중 취향 점수가 높은 순으로 채운다.
    #
    # 여기서는 family / anchor 제한을 완화한다.
    # ========================================================

    if len(results) < top_k:

        selected_ids = {
            item["id"]
            for item in results
        }

        fallback_candidates = [
            candidate
            for candidate in candidates
            if (
                candidate["id"]
                not in selected_ids
            )
        ]

        fallback_candidates.sort(
            key=lambda item:
                item["base_score"],
            reverse=True,
        )

        for candidate in fallback_candidates:

            candidate = dict(
                candidate
            )

            # fallback 후보라는 의미로
            # MMR 점수는 base_score 사용
            candidate[
                "mmr_score"
            ] = candidate[
                "base_score"
            ]

            results.append(
                candidate
            )

            if len(results) >= top_k:
                break


    # ========================================================
    # 5. 최종 결과
    # ========================================================

    return results

# ============================================================
# 최종 추천
# ============================================================

def recommend(
    user_embedding,
    food_rows,
    selected_foods,
    top_k=TOP_K,
):

    # ========================================================
    # 400개 음식 평균 벡터
    # ========================================================

    global_mean = (
        make_global_mean(
            food_rows
        )
    )


    # ========================================================
    # 사용자가 이미 좋아한다고 등록한 음식 IDs
    # ========================================================

    selected_food_ids = {

        row[0]

        for row
        in selected_foods
    }


    # ========================================================
    # 실제 선호 메뉴 각각을 anchor로 변환
    # ========================================================

    anchors = (
        make_preference_anchors(
            selected_foods,
            global_mean,
        )
    )


    # ========================================================
    # 대표 취향 + 실제 메뉴를 이용해 1차 후보 생성
    # ========================================================

    candidates = (
        make_candidate_pool(
            user_embedding,
            food_rows,
            selected_food_ids,
            anchors,
            global_mean,
        )
    )


    # ========================================================
    # candidates 생성 후에만 len(candidates)를 사용
    #
    # 이전 에러가 발생했던 부분
    # ========================================================

    print()

    print(
        f"MMR 후보 수 : "
        f"{len(candidates)}"
    )


    # ========================================================
    # MMR 재랭킹
    # ========================================================

    results = (
        rerank_with_mmr(
            candidates,
            anchors,
            top_k,
        )
    )


    return (
        results,
        candidates,
    )


# ============================================================
# 메인
# ============================================================

def main():

    # ========================================================
    # user_id 입력
    # ========================================================

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
            "recommend_for_user.py 1"
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


    # ========================================================
    # DB
    # ========================================================

    with psycopg.connect(
        DATABASE_URL
    ) as conn:


        # ----------------------------------------------------
        # 사용자
        # ----------------------------------------------------

        user = load_user(
            conn,
            user_id,
        )


        if not user:

            print()

            print(
                f"❌ user_id={user_id}의 "
                f"취향 임베딩이 없습니다."
            )

            print()

            print(
                "먼저 실행:"
            )

            print(
                "python scripts\\"
                "rebuild_user_taste_embedding.py "
                f"{user_id}"
            )

            return


        (
            db_user_id,
            email,
            user_embedding,
            embedding_dim,
            preference_count,
            model_name,
        ) = user


        # ----------------------------------------------------
        # 초기 카테고리
        # ----------------------------------------------------

        category_preferences = (
            load_category_preferences(
                conn,
                user_id,
            )
        )


        # ----------------------------------------------------
        # 실제 선호 메뉴
        # ----------------------------------------------------

        selected_foods = (
            load_selected_foods(
                conn,
                user_id,
            )
        )


        # ----------------------------------------------------
        # 전체 음식
        # ----------------------------------------------------

        food_rows = (
            load_foods(
                conn
            )
        )


        if not food_rows:

            print()

            print(
                "❌ 음식 임베딩 데이터가 없습니다."
            )

            return


        # ----------------------------------------------------
        # 사용자 embedding 길이 검사
        # ----------------------------------------------------

        if (
            len(user_embedding)
            != embedding_dim
        ):

            raise RuntimeError(
                "사용자 embedding_dim과 "
                "실제 벡터 길이가 다릅니다."
            )


        # ----------------------------------------------------
        # 음식 embedding 길이 검사
        # ----------------------------------------------------

        sample_food_embedding = (
            food_rows[0][4]
        )


        if (
            len(sample_food_embedding)
            != embedding_dim
        ):

            raise RuntimeError(
                "사용자 임베딩과 음식 임베딩의 "
                "차원이 다릅니다."
            )


        # ----------------------------------------------------
        # 추천
        # ----------------------------------------------------

        (
            recommendations,
            candidate_pool,
        ) = recommend(
            user_embedding,
            food_rows,
            selected_foods,
            top_k=TOP_K,
        )


    # ========================================================
    # 결과 출력
    # ========================================================

    print()

    print(
        "===================================="
    )

    print(
        "점메추 사용자 추천"
    )

    print(
        "===================================="
    )

    print()


    print(
        f"user_id       : "
        f"{db_user_id}"
    )

    print(
        f"email         : "
        f"{email}"
    )

    print(
        f"embedding_dim : "
        f"{embedding_dim}"
    )

    print(
        f"model         : "
        f"{model_name}"
    )


    # ========================================================
    # 초기 카테고리
    # ========================================================

    print()

    print(
        "초기 카테고리:"
    )


    if category_preferences:

        for category in (
            category_preferences
        ):

            print(
                f" - {category}"
            )

    else:

        print(
            " - 없음"
        )


    # ========================================================
    # 실제 선호 메뉴
    # ========================================================

    print()

    print(
        "실제 선호 메뉴:"
    )


    if selected_foods:

        for (
            food_id,
            name,
            weight,
            source,
            embedding,
        ) in selected_foods:

            print(
                f" - {name} "
                f"(weight={weight}, "
                f"source={source})"
            )

    else:

        print(
            " - 없음"
        )


    # ========================================================
    # 추천 설정
    # ========================================================

    print()

    print(
        "추천 설정:"
    )

    print(
        f" - 대표 취향 비중      : "
        f"{PROFILE_WEIGHT:.0%}"
    )

    print(
        f" - 최적 Anchor 비중    : "
        f"{BEST_ANCHOR_WEIGHT:.0%}"
    )

    print(
        f" - Anchor 평균 비중    : "
        f"{MEAN_ANCHOR_WEIGHT:.0%}"
    )

    print(
        f" - MMR Lambda          : "
        f"{MMR_LAMBDA:.2f}"
    )

    print(
        f" - 동일 계열 최대      : "
        f"{MAX_PER_FAMILY}개"
    )


    # ========================================================
    # 개수
    # ========================================================

    print()

    print(
        f"전체 취향 데이터 수 : "
        f"{preference_count}"
    )

    print(
        f"1차 후보 수         : "
        f"{len(candidate_pool)}"
    )

    print(
        f"최종 추천 수        : "
        f"{len(recommendations)}"
    )


    # ========================================================
    # 추천 TOP
    # ========================================================

    print()

    print(
        f"===== 다양성 추천 "
        f"TOP {len(recommendations)} ====="
    )

    print()


    for rank, item in enumerate(
        recommendations,
        start=1,
    ):

        anchor = (
            item[
                "best_anchor"
            ]
            or "대표취향"
        )


        print(
            f"{rank:>2}. "

            f"{item['name']:<16} "

            f"취향 "
            f"{item['base_score']:>6.3f} "

            f"| MMR "
            f"{item['mmr_score']:>6.3f} "

            f"| 기준: "
            f"{anchor:<8} "

            f"| 계열: "
            f"{item['family']:<6} "

            f"| "
            f"{item['cuisine_type'] or '-'}"
        )


# ============================================================
# 실행
# ============================================================

if __name__ == "__main__":
    main()