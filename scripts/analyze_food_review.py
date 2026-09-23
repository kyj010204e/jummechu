import csv
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

INPUT_PATH = (
    PROJECT_ROOT
    / "data"
    / "food_master_needs_review.csv"
)


def main():

    rows = []

    with open(
        INPUT_PATH,
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        reader = csv.DictReader(f)
        rows = list(reader)

    reasons = Counter()

    print()
    print("====================================")
    print("REVIEW 분석")
    print("====================================")
    print()

    for row in rows:

        name = row.get("name", "").strip()
        food_type = row.get("food_type", "").strip()
        ingredients = row.get(
            "main_ingredients",
            ""
        ).strip()

        missing = []

        if not food_type:
            missing.append("food_type 없음")

        if not ingredients:
            missing.append("주재료 없음")

        if not missing:
            missing.append(
                "정보 있음 / 강제 REVIEW"
            )

        reason = " + ".join(missing)

        reasons[reason] += 1

        print(
            f"{name:<20} "
            f"type={food_type or '-':<10} "
            f"ingredient={ingredients or '-':<25} "
            f"→ {reason}"
        )

    print()
    print("====================================")
    print("요약")
    print("====================================")

    for reason, count in reasons.most_common():
        print(
            f"{reason:<35} {count:>4}개"
        )


if __name__ == "__main__":
    main()