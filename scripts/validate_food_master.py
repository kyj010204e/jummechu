import csv
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

INPUT_PATH = (
    PROJECT_ROOT
    / "data"
    / "food_master_enriched.csv"
)

REPORT_PATH = (
    PROJECT_ROOT
    / "data"
    / "food_master_quality_report.csv"
)


GENERIC_INGREDIENTS = {
    "생선",
    "생선회",
    "생선알",
    "해산물",
    "채소",
    "다진고기",
    "내장",
    "면",
    "쌀",
}


def split_pipe(value):
    if not value:
        return []

    return [
        x.strip()
        for x in value.split("|")
        if x.strip()
    ]


def main():
    with open(
        INPUT_PATH,
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:
        rows = list(csv.DictReader(f))

    issues = []

    # ========================================================
    # 이름 중복
    # ========================================================

    names = [
        row.get("name", "").strip()
        for row in rows
    ]

    name_counts = Counter(names)

    for name, count in name_counts.items():
        if name and count > 1:
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "중복 음식명",
                "detail": f"{count}개 존재",
            })

    # ========================================================
    # 음식별 검사
    # ========================================================

    for row in rows:

        name = row.get("name", "").strip()
        food_type = row.get(
            "food_type",
            ""
        ).strip()

        ingredients = split_pipe(
            row.get(
                "main_ingredients",
                ""
            )
        )

        cuisine = row.get(
            "cuisine_type",
            ""
        ).strip()

        status = row.get(
            "enrichment_status",
            ""
        ).strip()

        # -----------------------------------------------
        # 필수값
        # -----------------------------------------------

        if not name:
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "음식명 없음",
                "detail": "",
            })

        if not food_type:
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "food_type 없음",
                "detail": "",
            })

        if not ingredients:
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "주재료 없음",
                "detail": "",
            })

        if status != "auto":
            issues.append({
                "severity": "WARNING",
                "food_name": name,
                "issue": "AUTO 아님",
                "detail": status,
            })

        # -----------------------------------------------
        # 너무 일반적인 재료만 있는 음식
        # -----------------------------------------------

        if (
            ingredients
            and all(
                ingredient in GENERIC_INGREDIENTS
                for ingredient in ingredients
            )
        ):
            issues.append({
                "severity": "REVIEW",
                "food_name": name,
                "issue": "주재료가 너무 일반적",
                "detail": "|".join(ingredients),
            })

        # -----------------------------------------------
        # 간단한 충돌 검사
        # -----------------------------------------------

        if (
            "오리" in name
            and "소고기" in ingredients
        ):
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "재료 충돌",
                "detail": "오리 음식에 소고기 포함",
            })

        if (
            "돼지" in name
            and "소고기" in ingredients
        ):
            issues.append({
                "severity": "ERROR",
                "food_name": name,
                "issue": "재료 충돌",
                "detail": "돼지 음식에 소고기 포함",
            })

        if (
            "닭" in name
            and "닭고기" not in ingredients
            and "닭모래집" not in ingredients
        ):
            issues.append({
                "severity": "REVIEW",
                "food_name": name,
                "issue": "닭 재료 확인",
                "detail": "|".join(ingredients),
            })

    # ========================================================
    # 결과 저장
    # ========================================================

    fieldnames = [
        "severity",
        "food_name",
        "issue",
        "detail",
    ]

    with open(
        REPORT_PATH,
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
        )

        writer.writeheader()
        writer.writerows(issues)

    errors = sum(
        1 for x in issues
        if x["severity"] == "ERROR"
    )

    reviews = sum(
        1 for x in issues
        if x["severity"] == "REVIEW"
    )

    warnings = sum(
        1 for x in issues
        if x["severity"] == "WARNING"
    )

    print()
    print("====================================")
    print("Food Master 품질검사")
    print("====================================")
    print()

    print(f"전체 음식 : {len(rows)}")
    print(f"ERROR     : {errors}")
    print(f"REVIEW    : {reviews}")
    print(f"WARNING   : {warnings}")

    print()
    print("리포트:")
    print(REPORT_PATH)

    print()

    if errors == 0:
        print("✅ 치명적인 오류 없음")
    else:
        print("❌ DB import 전에 ERROR 수정 필요")

    if issues:
        print()
        print("===== 검사 결과 =====")

        for item in issues[:50]:
            print(
                f"[{item['severity']}] "
                f"{item['food_name']} → "
                f"{item['issue']} "
                f"({item['detail']})"
            )


if __name__ == "__main__":
    main()