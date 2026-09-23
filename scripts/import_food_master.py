from pathlib import Path
import csv
import os

import psycopg
from dotenv import load_dotenv


# ============================================================
# 경로
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CSV_PATH = PROJECT_ROOT / "data" / "food_master_enriched.csv"

load_dotenv(PROJECT_ROOT / ".env")


DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL을 찾을 수 없습니다.")


# ============================================================
# 문자열 -> 배열
#
# 예:
# "매콤|짭짤"
# ->
# ["매콤", "짭짤"]
# ============================================================

def split_values(value):
    if not value:
        return []

    return [
        item.strip()
        for item in value.split("|")
        if item.strip()
    ]


# ============================================================
# MAIN
# ============================================================

def main():

    if not CSV_PATH.exists():
        raise FileNotFoundError(
            f"CSV 파일이 없습니다: {CSV_PATH}"
        )

    with open(
        CSV_PATH,
        "r",
        encoding="utf-8-sig",
        newline=""
    ) as file:

        rows = list(
            csv.DictReader(file)
        )

    print(
        f"음식 {len(rows)}개를 불러왔습니다."
    )

    with psycopg.connect(
        DATABASE_URL
    ) as conn:

        with conn.cursor() as cur:

            for row in rows:

                name = row["name"].strip()

                if not name:
                    continue

                cuisine_type = (
                    row["cuisine_type"].strip()
                    or None
                )

                food_type = (
                    row["food_type"].strip()
                    or None
                )

                taste_tags = split_values(
                    row["taste_tags"]
                )

                cooking_methods = split_values(
                    row["cooking_methods"]
                )

                staple_types = split_values(
                    row["staple_types"]
                )

                description = (
                    row["description"].strip()
                    or None
                )

                source = (
                    row["source"].strip()
                    or "manual"
                )

                source_code = (
                    row["source_code"].strip()
                    or None
                )

                # ============================================
                # FOOD UPSERT
                # ============================================

                cur.execute(
                    """
                    INSERT INTO foods (
                        name,
                        cuisine_type,
                        food_type,
                        taste_tags,
                        cooking_methods,
                        staple_types,
                        description,
                        source,
                        source_code
                    )
                    VALUES (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )

                    ON CONFLICT (name)
                    DO UPDATE SET

                        cuisine_type =
                            EXCLUDED.cuisine_type,

                        food_type =
                            EXCLUDED.food_type,

                        taste_tags =
                            EXCLUDED.taste_tags,

                        cooking_methods =
                            EXCLUDED.cooking_methods,

                        staple_types =
                            EXCLUDED.staple_types,

                        description =
                            EXCLUDED.description,

                        source =
                            EXCLUDED.source,

                        source_code =
                            EXCLUDED.source_code,

                        updated_at =
                            CURRENT_TIMESTAMP

                    RETURNING id;
                    """,
                    (
                        name,
                        cuisine_type,
                        food_type,
                        taste_tags,
                        cooking_methods,
                        staple_types,
                        description,
                        source,
                        source_code,
                    )
                )

                food_id = (
                    cur.fetchone()[0]
                )

                # ============================================
                # 재료 목록
                # ============================================

                ingredient_groups = {

                    "main":
                        split_values(
                            row[
                                "main_ingredients"
                            ]
                        ),

                    "sub":
                        split_values(
                            row[
                                "sub_ingredients"
                            ]
                        ),

                    "seasoning":
                        split_values(
                            row[
                                "seasonings"
                            ]
                        ),
                }

                # CSV를 다시 실행할 때
                # 기존 연결 중 해당 source 데이터 갱신
                cur.execute(
                    """
                    DELETE FROM food_ingredients
                    WHERE food_id = %s
                    AND source = %s
                    """,
                    (
                        food_id,
                        source,
                    )
                )

                # ============================================
                # INGREDIENT UPSERT
                # ============================================

                for (
                    role,
                    ingredient_names
                ) in ingredient_groups.items():

                    for ingredient_name in ingredient_names:

                        cur.execute(
                            """
                            INSERT INTO ingredients (
                                name
                            )
                            VALUES (%s)

                            ON CONFLICT (name)
                            DO UPDATE SET
                                name = EXCLUDED.name

                            RETURNING id;
                            """,
                            (
                                ingredient_name,
                            )
                        )

                        ingredient_id = (
                            cur.fetchone()[0]
                        )

                        # ================================
                        # FOOD <-> INGREDIENT
                        # ================================

                        cur.execute(
                            """
                            INSERT INTO food_ingredients (
                                food_id,
                                ingredient_id,
                                role,
                                confidence,
                                source
                            )
                            VALUES (
                                %s,
                                %s,
                                %s,
                                %s,
                                %s
                            )

                            ON CONFLICT (
                                food_id,
                                ingredient_id
                            )

                            DO UPDATE SET

                                role =
                                    EXCLUDED.role,

                                confidence =
                                    EXCLUDED.confidence,

                                source =
                                    EXCLUDED.source;
                            """,
                            (
                                food_id,
                                ingredient_id,
                                role,
                                1.0,
                                source,
                            )
                        )

                # ============================================
                # ALIASES
                # ============================================

                aliases = split_values(
                    row["aliases"]
                )

                for alias in aliases:

                    cur.execute(
                        """
                        INSERT INTO food_aliases (
                            food_id,
                            alias
                        )

                        VALUES (
                            %s,
                            %s
                        )

                        ON CONFLICT (alias)
                        DO NOTHING;
                        """,
                        (
                            food_id,
                            alias,
                        )
                    )

                print(
                    f"✅ {name}"
                )

        conn.commit()

    print()
    print(
        "음식 Master DB 등록 완료"
    )


if __name__ == "__main__":
    main()