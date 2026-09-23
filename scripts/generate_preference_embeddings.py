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
from sentence_transformers import (
    SentenceTransformer,
)


# ============================================================
# 설정
# ============================================================

PROJECT_ROOT = (
    Path(__file__).resolve().parent.parent
)

MODEL_NAME = (
    "intfloat/multilingual-e5-small"
)

MIN_FOOD_COUNT = 5


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
# Prisma schema 파라미터 제거
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
# 정규화
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
# 카테고리 설명
# ============================================================

CATEGORY_TEXTS = {

    "korean":
        "한식, 밥, 국, 찌개, 비빔밥, "
        "불고기, 제육볶음, 김치요리 등 "
        "한국 음식",

    "japanese":
        "일식, 초밥, 회, 우동, 돈가스, "
        "일본식 덮밥 등 일본 음식",

    "noodle":
        "면요리, 국수, 냉면, 라면, "
        "우동, 칼국수, 짬뽕, 파스타",

    "burger":
        "햄버거, 버거, 패티, 치즈버거, "
        "수제버거 등 버거 음식",

    "pizza":
        "피자, 치즈피자, 페퍼로니피자, "
        "고르곤졸라피자 등 피자 음식",

    "chicken":
        "치킨, 닭요리, 닭갈비, 닭강정, "
        "후라이드치킨, 양념치킨",

    "cafe":
        "카페 음식, 커피, 케이크, 빵, "
        "디저트, 샌드위치, 음료",
}


# ============================================================
# 카테고리 음식 조회
# ============================================================

CATEGORY_SQL = {

    "korean": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE f.cuisine_type = '한식'
    """,

    "japanese": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE f.cuisine_type = '일식'
    """,

    "noodle": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE
            '면' = ANY(f.staple_types)
            OR f.food_type IN (
                '국수',
                '라면',
                '우동',
                '짬뽕',
                '자장면'
            )
    """,

    "burger": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE
            f.food_type = '버거'
            OR f.name LIKE '%버거%'
    """,

    "pizza": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE
            f.food_type = '피자'
            OR f.name LIKE '%피자%'
    """,

    "chicken": """
        SELECT DISTINCT
            fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        LEFT JOIN food_ingredients fi
            ON fi.food_id = f.id
        LEFT JOIN ingredients i
            ON i.id = fi.ingredient_id
        WHERE
            i.name = '닭고기'
            OR f.name LIKE '%닭%'
            OR f.name LIKE '%치킨%'
    """,

    "cafe": """
        SELECT fe.embedding
        FROM foods f
        JOIN food_embeddings fe
            ON fe.food_id = f.id
        WHERE
            f.food_type IN (
                '디저트',
                '빵',
                '음료'
            )
            OR f.name LIKE '%커피%'
            OR f.name LIKE '%케이크%'
    """,
}


# ============================================================
# DB 음식 벡터 평균
# ============================================================

def make_centroid(rows):

    vectors = [
        normalize(row[0])
        for row in rows
    ]

    centroid = np.mean(
        vectors,
        axis=0,
    )

    return normalize(
        centroid
    )


# ============================================================
# 저장
# ============================================================

def save_category(
    conn,
    category,
    embedding,
    food_count,
    source_type,
):

    vector = embedding.tolist()

    sql = """
    INSERT INTO
        preference_category_embeddings (
            category,
            embedding,
            embedding_dim,
            model_name,
            food_count,
            source_type,
            updated_at
        )
    VALUES (
        %s,
        %s,
        %s,
        %s,
        %s,
        %s,
        CURRENT_TIMESTAMP
    )

    ON CONFLICT (category)

    DO UPDATE SET
        embedding =
            EXCLUDED.embedding,

        embedding_dim =
            EXCLUDED.embedding_dim,

        model_name =
            EXCLUDED.model_name,

        food_count =
            EXCLUDED.food_count,

        source_type =
            EXCLUDED.source_type,

        updated_at =
            CURRENT_TIMESTAMP
    """

    with conn.cursor() as cur:

        cur.execute(
            sql,
            (
                category,
                vector,
                len(vector),
                MODEL_NAME,
                food_count,
                source_type,
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
        "Preference Category Embedding"
    )
    print(
        "===================================="
    )
    print()

    model = SentenceTransformer(
        MODEL_NAME
    )

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        for category in CATEGORY_SQL:

            with conn.cursor() as cur:

                cur.execute(
                    CATEGORY_SQL[
                        category
                    ]
                )

                rows = (
                    cur.fetchall()
                )

            food_count = len(rows)

            # ================================================
            # 음식이 충분하면 실제 음식 벡터 평균
            # ================================================

            if (
                food_count
                >= MIN_FOOD_COUNT
            ):

                embedding = (
                    make_centroid(
                        rows
                    )
                )

                source_type = (
                    "food_centroid"
                )

            # ================================================
            # 음식 부족하면 텍스트 fallback
            # ================================================

            else:

                text = (
                    "query: "
                    + CATEGORY_TEXTS[
                        category
                    ]
                )

                embedding = (
                    model.encode(
                        text,
                        normalize_embeddings=True,
                    )
                )

                embedding = (
                    normalize(
                        embedding
                    )
                )

                source_type = (
                    "text_fallback"
                )

            save_category(
                conn,
                category,
                embedding,
                food_count,
                source_type,
            )

            print(
                f"{category:<10} "
                f"{food_count:>3}개 "
                f"→ {source_type}"
            )

        conn.commit()

    print()
    print(
        "✅ 카테고리 임베딩 저장 완료"
    )


if __name__ == "__main__":
    main()