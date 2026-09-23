import os
from pathlib import Path
from urllib.parse import (
    urlparse,
    parse_qsl,
    urlencode,
    urlunparse,
)

import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer


# ============================================================
# 기본 설정
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_NAME = "intfloat/multilingual-e5-small"


# ============================================================
# 환경변수
# ============================================================

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
# Prisma URL의 schema=public 제거
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
# 배열 → 문자열
# ============================================================

def join_values(values):

    if not values:
        return ""

    if isinstance(values, str):
        return values.strip()

    return ", ".join(
        str(value).strip()
        for value in values
        if str(value).strip()
    )


# ============================================================
# 음식 Feature Text 생성
# ============================================================

def make_feature_text(row):

    (
        food_id,
        name,
        cuisine_type,
        food_type,
        taste_tags,
        cooking_methods,
        staple_types,
        main_ingredients,
        sub_ingredients,
        seasonings,
    ) = row

    parts = [
        f"음식명: {name}"
    ]

    if cuisine_type:
        parts.append(
            f"요리 분류: {cuisine_type}"
        )

    if food_type:
        parts.append(
            f"음식 유형: {food_type}"
        )

    main_text = join_values(
        main_ingredients
    )

    if main_text:
        parts.append(
            f"주재료: {main_text}"
        )

    sub_text = join_values(
        sub_ingredients
    )

    if sub_text:
        parts.append(
            f"부재료: {sub_text}"
        )

    seasoning_text = join_values(
        seasonings
    )

    if seasoning_text:
        parts.append(
            f"양념: {seasoning_text}"
        )

    taste_text = join_values(
        taste_tags
    )

    if taste_text:
        parts.append(
            f"맛 특징: {taste_text}"
        )

    cooking_text = join_values(
        cooking_methods
    )

    if cooking_text:
        parts.append(
            f"조리 방식: {cooking_text}"
        )

    staple_text = join_values(
        staple_types
    )

    if staple_text:
        parts.append(
            f"주식 형태: {staple_text}"
        )

    # E5 모델의 문서/후보 임베딩 prefix
    return (
        "passage: "
        + " | ".join(parts)
    )


# ============================================================
# DB에서 음식 정보 가져오기
# ============================================================

def load_foods(conn):

    sql = """
    SELECT
        f.id,
        f.name,
        COALESCE(f.cuisine_type, ''),
        COALESCE(f.food_type, ''),
        COALESCE(f.taste_tags, ARRAY[]::TEXT[]),
        COALESCE(f.cooking_methods, ARRAY[]::TEXT[]),
        COALESCE(f.staple_types, ARRAY[]::TEXT[]),

        COALESCE(
            ARRAY_AGG(
                DISTINCT i.name
            ) FILTER (
                WHERE fi.role = 'main'
            ),
            ARRAY[]::TEXT[]
        ) AS main_ingredients,

        COALESCE(
            ARRAY_AGG(
                DISTINCT i.name
            ) FILTER (
                WHERE fi.role = 'sub'
            ),
            ARRAY[]::TEXT[]
        ) AS sub_ingredients,

        COALESCE(
            ARRAY_AGG(
                DISTINCT i.name
            ) FILTER (
                WHERE fi.role = 'seasoning'
            ),
            ARRAY[]::TEXT[]
        ) AS seasonings

    FROM foods f

    LEFT JOIN food_ingredients fi
        ON fi.food_id = f.id

    LEFT JOIN ingredients i
        ON i.id = fi.ingredient_id

    GROUP BY
        f.id,
        f.name,
        f.cuisine_type,
        f.food_type,
        f.taste_tags,
        f.cooking_methods,
        f.staple_types

    ORDER BY f.id;
    """

    with conn.cursor() as cur:

        cur.execute(sql)

        return cur.fetchall()


# ============================================================
# DB 저장
# ============================================================

def save_embeddings(
    conn,
    rows,
    feature_texts,
    embeddings,
):

    sql = """
    INSERT INTO food_embeddings (
        food_id,
        feature_text,
        embedding,
        embedding_dim,
        model_name,
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

    ON CONFLICT (food_id)

    DO UPDATE SET

        feature_text =
            EXCLUDED.feature_text,

        embedding =
            EXCLUDED.embedding,

        embedding_dim =
            EXCLUDED.embedding_dim,

        model_name =
            EXCLUDED.model_name,

        updated_at =
            CURRENT_TIMESTAMP;
    """

    with conn.cursor() as cur:

        for row, feature_text, embedding in zip(
            rows,
            feature_texts,
            embeddings,
        ):

            food_id = row[0]

            vector = embedding.tolist()

            cur.execute(
                sql,
                (
                    food_id,
                    feature_text,
                    vector,
                    len(vector),
                    MODEL_NAME,
                ),
            )

    conn.commit()


# ============================================================
# 메인
# ============================================================

def main():

    print()
    print("====================================")
    print("Food Embedding 생성")
    print("====================================")
    print()

    # ----------------------------------------
    # DB 음식 로드
    # ----------------------------------------

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        rows = load_foods(conn)

        print(
            f"DB 음식 수 : {len(rows)}"
        )

        if not rows:
            print("음식 데이터가 없습니다.")
            return

        # ------------------------------------
        # Feature Text 생성
        # ------------------------------------

        feature_texts = [
            make_feature_text(row)
            for row in rows
        ]

        print()
        print("===== Feature Text 예시 =====")
        print()

        for text in feature_texts[:5]:
            print(text)
            print()

        # ------------------------------------
        # 모델 로딩
        # ------------------------------------

        print(
            f"모델 로딩 : {MODEL_NAME}"
        )

        model = SentenceTransformer(
            MODEL_NAME
        )

        print("모델 로딩 완료")
        print()

        # ------------------------------------
        # 임베딩 생성
        # ------------------------------------

        print("임베딩 생성 중...")

        embeddings = model.encode(
            feature_texts,

            batch_size=32,

            show_progress_bar=True,

            normalize_embeddings=True,
        )

        print()
        print("✅ 임베딩 생성 완료")

        print(
            f"개수 : {len(embeddings)}"
        )

        print(
            f"차원 : {embeddings.shape[1]}"
        )

        # ------------------------------------
        # DB 저장
        # ------------------------------------

        print()
        print("DB 저장 중...")

        save_embeddings(
            conn,
            rows,
            feature_texts,
            embeddings,
        )

        print("✅ DB 저장 완료")


if __name__ == "__main__":
    main()