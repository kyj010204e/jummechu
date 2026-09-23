import csv
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

import psycopg
from dotenv import load_dotenv


# ============================================================
# 경로 설정
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

CSV_PATH = (
    PROJECT_ROOT
    / "data"
    / "nutrition_clean.csv"
)


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
# Prisma URL의 schema=public 같은 옵션 제거
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
# 숫자 변환
# ============================================================

def to_float(value):

    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    if value.lower() in {
        "nan",
        "none",
        "null",
    }:
        return None

    try:
        return float(value)

    except ValueError:
        return None


# ============================================================
# 메인
# ============================================================

def main():

    print()
    print("====================================")
    print("영양정보 DB Import")
    print("====================================")
    print()

    print("CSV:")
    print(CSV_PATH)
    print()

    if not CSV_PATH.exists():
        raise FileNotFoundError(
            f"CSV 파일 없음: {CSV_PATH}"
        )

    total = 0
    matched = 0
    unmatched = []

    with open(
        CSV_PATH,
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        reader = csv.DictReader(f)

        with psycopg.connect(
            DATABASE_URL
        ) as conn:

            with conn.cursor() as cur:

                for row in reader:

                    total += 1

                    food_name = (
                        row.get(
                            "food_name",
                            ""
                        )
                        .strip()
                    )

                    if not food_name:
                        continue

                    # ----------------------------------------
                    # foods 테이블에서 음식 ID 찾기
                    # ----------------------------------------

                    cur.execute(
                        """
                        SELECT id
                        FROM foods
                        WHERE name = %s
                        """,
                        (food_name,),
                    )

                    result = cur.fetchone()

                    if not result:
                        unmatched.append(
                            food_name
                        )
                        continue

                    food_id = result[0]

                    # ----------------------------------------
                    # 영양정보 INSERT / UPDATE
                    # ----------------------------------------

                    cur.execute(
                        """
                        INSERT INTO food_nutrition (
                            food_id,
                            serving_g,
                            kcal,
                            carbohydrate_g,
                            sugar_g,
                            fat_g,
                            protein_g,
                            calcium_mg,
                            phosphorus_mg,
                            sodium_mg,
                            potassium_mg,
                            magnesium_mg,
                            iron_mg,
                            zinc_mg,
                            cholesterol_mg,
                            trans_fat_g,
                            updated_at
                        )
                        VALUES (
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            CURRENT_TIMESTAMP
                        )

                        ON CONFLICT (food_id)
                        DO UPDATE SET
                            serving_g =
                                EXCLUDED.serving_g,

                            kcal =
                                EXCLUDED.kcal,

                            carbohydrate_g =
                                EXCLUDED.carbohydrate_g,

                            sugar_g =
                                EXCLUDED.sugar_g,

                            fat_g =
                                EXCLUDED.fat_g,

                            protein_g =
                                EXCLUDED.protein_g,

                            calcium_mg =
                                EXCLUDED.calcium_mg,

                            phosphorus_mg =
                                EXCLUDED.phosphorus_mg,

                            sodium_mg =
                                EXCLUDED.sodium_mg,

                            potassium_mg =
                                EXCLUDED.potassium_mg,

                            magnesium_mg =
                                EXCLUDED.magnesium_mg,

                            iron_mg =
                                EXCLUDED.iron_mg,

                            zinc_mg =
                                EXCLUDED.zinc_mg,

                            cholesterol_mg =
                                EXCLUDED.cholesterol_mg,

                            trans_fat_g =
                                EXCLUDED.trans_fat_g,

                            updated_at =
                                CURRENT_TIMESTAMP
                        """,
                        (
                            food_id,

                            to_float(
                                row.get(
                                    "serving_g"
                                )
                            ),

                            to_float(
                                row.get(
                                    "kcal"
                                )
                            ),

                            to_float(
                                row.get(
                                    "carbohydrate_g"
                                )
                            ),

                            to_float(
                                row.get(
                                    "sugar_g"
                                )
                            ),

                            to_float(
                                row.get(
                                    "fat_g"
                                )
                            ),

                            to_float(
                                row.get(
                                    "protein_g"
                                )
                            ),

                            to_float(
                                row.get(
                                    "calcium_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "phosphorus_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "sodium_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "potassium_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "magnesium_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "iron_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "zinc_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "cholesterol_mg"
                                )
                            ),

                            to_float(
                                row.get(
                                    "trans_fat_g"
                                )
                            ),
                        ),
                    )

                    matched += 1

            conn.commit()

    print("✅ Import 완료")
    print()

    print(f"CSV 전체     : {total}")
    print(f"DB 매칭      : {matched}")
    print(
        f"매칭 실패    : "
        f"{len(unmatched)}"
    )

    if unmatched:

        print()
        print(
            "===== 매칭 실패 음식 ====="
        )

        for name in unmatched:
            print(name)


if __name__ == "__main__":
    main()