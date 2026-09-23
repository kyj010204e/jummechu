import csv
import re
from pathlib import Path



from pathlib import Path

INPUT_PATH = Path(r"C:\Users\301-03\Downloads\food_master_seed.csv")
OUTPUT_PATH = Path(r"C:\Users\301-03\Downloads\food_master_enriched.csv")


# ============================================================
# 공통 함수
# ============================================================

def split_pipe(value):
    if not value:
        return []

    return [
        x.strip()
        for x in str(value).split("|")
        if x.strip()
    ]


def unique(items):
    result = []

    for item in items:
        item = item.strip()

        if item and item not in result:
            result.append(item)

    return result


def join_pipe(items):
    return "|".join(unique(items))


def contains_any(text, keywords):
    return any(keyword in text for keyword in keywords)


# ============================================================
# 한식 / 일식 / 중식 / 양식 추정
# ============================================================

JAPANESE_KEYWORDS = [
    "초밥",
    "스시",
    "우동",
    "소바",
    "라멘",
    "돈부리",
    "가츠",
    "돈까스",
    "돈가스",
    "규동",
    "오니기리",
    "사시미",
    "회덮밥",
]

CHINESE_KEYWORDS = [
    "짜장",
    "자장",
    "짬뽕",
    "탕수육",
    "마파두부",
    "양장피",
    "깐풍",
    "유산슬",
    "팔보채",
    "고추잡채",
    "마라",
]

WESTERN_KEYWORDS = [
    "파스타",
    "스파게티",
    "피자",
    "스테이크",
    "햄버거",
    "버거",
    "샌드위치",
    "리조또",
    "오믈렛",
    "그라탕",
    "커틀릿",
]

ASIAN_ETC_KEYWORDS = [
    "쌀국수",
    "팟타이",
    "똠양",
    "나시고렝",
    "분짜",
    "커리",
]


def infer_cuisine(name):
    if contains_any(name, JAPANESE_KEYWORDS):
        return "일식"

    if contains_any(name, CHINESE_KEYWORDS):
        return "중식"

    if contains_any(name, WESTERN_KEYWORDS):
        return "양식"

    if contains_any(name, ASIAN_ETC_KEYWORDS):
        return "아시아"

    # AIHub 음식 대부분이 국내 음식이므로
    # 한식으로 보기에 비교적 명확한 패턴만 처리
    korean_patterns = [
        "국",
        "찌개",
        "탕",
        "전골",
        "나물",
        "김치",
        "비빔밥",
        "볶음밥",
        "죽",
        "국밥",
        "갈비",
        "불고기",
        "제육",
        "떡",
        "전",
        "장아찌",
        "쌈",
        "냉면",
        "칼국수",
        "수제비",
    ]

    if contains_any(name, korean_patterns):
        return "한식"

    return ""


# ============================================================
# 음식 유형
# ============================================================

FOOD_TYPE_RULES = [
    ("볶음밥", ["볶음밥"]),
    ("비빔밥", ["비빔밥"]),
    ("덮밥", ["덮밥"]),
    ("국밥", ["국밥"]),
    ("죽", ["죽"]),
    ("밥", ["밥"]),

    ("찌개", ["찌개"]),
    ("전골", ["전골"]),
    ("탕", ["탕"]),
    ("국", ["국"]),

    ("볶음", ["볶음"]),
    ("구이", ["구이"]),
    ("찜", ["찜"]),
    ("조림", ["조림"]),
    ("튀김", ["튀김"]),
    ("전", ["전"]),
    ("무침", ["무침"]),

    ("라면", ["라면", "라멘"]),
    ("국수", ["국수", "소바", "우동", "냉면"]),
    ("파스타", ["파스타", "스파게티"]),

    ("만두", ["만두"]),
    ("떡", ["떡"]),
    ("김밥", ["김밥"]),
    ("초밥", ["초밥", "스시"]),

    ("피자", ["피자"]),
    ("버거", ["햄버거", "버거"]),
    ("샌드위치", ["샌드위치"]),

    ("샐러드", ["샐러드"]),
    ("빵", ["빵", "베이글", "도넛"]),
]


def infer_food_type(name):
    for food_type, keywords in FOOD_TYPE_RULES:
        if contains_any(name, keywords):
            return food_type

    return ""


# ============================================================
# 주재료 추정
# ============================================================

INGREDIENT_RULES = [
    ("돼지고기", [
        "돼지",
        "제육",
        "돈까스",
        "돈가스",
        "삼겹",
        "족발",
        "보쌈",
    ]),

    ("소고기", [
        "소고기",
        "쇠고기",
        "불고기",
        "육회",
        "갈비탕",
        "설렁탕",
        "곰탕",
    ]),

    ("닭고기", [
        "닭",
        "치킨",
        "삼계탕",
    ]),

    ("오리고기", [
        "오리",
    ]),

    ("김치", [
        "김치",
    ]),

    ("두부", [
        "두부",
    ]),

    ("전복", [
        "전복",
    ]),

    ("낙지", [
        "낙지",
    ]),

    ("오징어", [
        "오징어",
    ]),

    ("문어", [
        "문어",
    ]),

    ("주꾸미", [
        "주꾸미",
        "쭈꾸미",
    ]),

    ("새우", [
        "새우",
    ]),

    ("게", [
        "게장",
        "꽃게",
        "대게",
    ]),

    ("굴", [
        "굴",
    ]),

    ("조개", [
        "조개",
        "바지락",
        "홍합",
    ]),

    ("생선", [
        "고등어",
        "갈치",
        "조기",
        "꽁치",
        "연어",
        "참치",
        "광어",
        "우럭",
    ]),

    ("달걀", [
        "계란",
        "달걀",
        "에그",
    ]),

    ("버섯", [
        "버섯",
        "표고",
        "송이",
    ]),

    ("감자", [
        "감자",
    ]),

    ("고구마", [
        "고구마",
    ]),

    ("옥수수", [
        "옥수수",
        "콘",
    ]),

    ("호박", [
        "호박",
    ]),

    ("콩", [
        "콩",
    ]),

    ("팥", [
        "팥",
    ]),

    ("메밀", [
        "메밀",
        "소바",
    ]),
]


def infer_main_ingredients(name):
    ingredients = []

    for ingredient, keywords in INGREDIENT_RULES:
        if contains_any(name, keywords):
            ingredients.append(ingredient)

    # 밥류
    if contains_any(
        name,
        [
            "밥",
            "죽",
            "김밥",
            "주먹밥",
        ],
    ):
        ingredients.append("쌀")

    # 면류
    if contains_any(
        name,
        [
            "국수",
            "칼국수",
            "우동",
            "라면",
            "라멘",
            "스파게티",
            "파스타",
        ],
    ):
        ingredients.append("면")

    # 떡
    if "떡" in name:
        ingredients.append("쌀")

    return unique(ingredients)


# ============================================================
# 조리 방법
# ============================================================

COOKING_RULES = [
    ("볶음", ["볶음"]),
    ("구이", ["구이", "스테이크"]),
    ("튀김", ["튀김", "돈까스", "돈가스", "치킨"]),
    ("찜", ["찜"]),
    ("조림", ["조림"]),
    ("삶기", ["수육", "보쌈", "족발"]),
    ("끓임", [
        "국",
        "탕",
        "찌개",
        "전골",
        "죽",
        "라면",
        "라멘",
        "우동",
        "칼국수",
        "수제비",
    ]),
    ("부침", ["전", "부침"]),
    ("무침", ["무침"]),
    ("비빔", ["비빔"]),
]


def infer_cooking_methods(name):
    result = []

    for method, keywords in COOKING_RULES:
        if contains_any(name, keywords):
            result.append(method)

    return unique(result)


# ============================================================
# 주식 형태
# ============================================================

def infer_staple_types(name):
    result = []

    if contains_any(
        name,
        [
            "밥",
            "김밥",
            "죽",
            "주먹밥",
            "리조또",
        ],
    ):
        result.append("밥")

    if contains_any(
        name,
        [
            "면",
            "국수",
            "라면",
            "라멘",
            "우동",
            "소바",
            "냉면",
            "파스타",
            "스파게티",
        ],
    ):
        result.append("면")

    if contains_any(
        name,
        [
            "빵",
            "샌드위치",
            "버거",
            "피자",
            "베이글",
        ],
    ):
        result.append("빵")

    return unique(result)


# ============================================================
# 맛 태그
#
# 맛은 음식 이름만 보고 확정하기 어려우므로
# 비교적 명확한 경우만 넣는다.
# ============================================================

def infer_taste_tags(name):
    result = []

    spicy_keywords = [
        "매운",
        "매콤",
        "불닭",
        "제육",
        "떡볶이",
        "짬뽕",
        "김치찌개",
        "마라",
        "낙지볶음",
        "주꾸미볶음",
    ]

    sweet_keywords = [
        "달콤",
        "꿀",
        "허니",
        "양념치킨",
    ]

    sour_keywords = [
        "초무침",
        "냉채",
    ]

    if contains_any(name, spicy_keywords):
        result.append("매콤")

    if contains_any(name, sweet_keywords):
        result.append("달콤")

    if contains_any(name, sour_keywords):
        result.append("새콤")

    return unique(result)


# ============================================================
# 신뢰도 판정
# ============================================================

def determine_status(
    cuisine_type,
    food_type,
    main_ingredients,
    cooking_methods,
):
    score = 0

    if cuisine_type:
        score += 1

    if food_type:
        score += 1

    if main_ingredients:
        score += 2

    if cooking_methods:
        score += 1

    if score >= 4:
        return "auto"

    if score >= 2:
        return "review"

    return "unknown"


# ============================================================
# 설명 자동 생성
# ============================================================

def build_description(
    name,
    cuisine_type,
    food_type,
    ingredients,
    cooking_methods,
):
    parts = []

    if cuisine_type:
        parts.append(cuisine_type)

    if food_type:
        parts.append(food_type)

    description = name

    if ingredients:
        description += (
            " / 주요 재료: "
            + ", ".join(ingredients)
        )

    if cooking_methods:
        description += (
            " / 조리법: "
            + ", ".join(cooking_methods)
        )

    if parts:
        description += (
            " / 분류: "
            + ", ".join(parts)
        )

    return description


# ============================================================
# 한 음식 처리
# ============================================================

def enrich_row(row):

    name = row.get("name", "").strip()

    cuisine_type = (
        row.get("cuisine_type", "").strip()
        or infer_cuisine(name)
    )

    food_type = (
        row.get("food_type", "").strip()
        or infer_food_type(name)
    )

    existing_main = split_pipe(
        row.get(
            "main_ingredients",
            ""
        )
    )

    inferred_main = (
        infer_main_ingredients(name)
    )

    main_ingredients = unique(
        existing_main
        + inferred_main
    )

    cooking_methods = unique(
        split_pipe(
            row.get(
                "cooking_methods",
                ""
            )
        )
        + infer_cooking_methods(name)
    )

    staple_types = unique(
        split_pipe(
            row.get(
                "staple_types",
                ""
            )
        )
        + infer_staple_types(name)
    )

    taste_tags = unique(
        split_pipe(
            row.get(
                "taste_tags",
                ""
            )
        )
        + infer_taste_tags(name)
    )

    status = determine_status(
        cuisine_type,
        food_type,
        main_ingredients,
        cooking_methods,
    )

    description = (
        row.get("description", "").strip()
        or build_description(
            name,
            cuisine_type,
            food_type,
            main_ingredients,
            cooking_methods,
        )
    )

    row["cuisine_type"] = cuisine_type
    row["food_type"] = food_type

    row["main_ingredients"] = (
        join_pipe(
            main_ingredients
        )
    )

    row["taste_tags"] = (
        join_pipe(
            taste_tags
        )
    )

    row["cooking_methods"] = (
        join_pipe(
            cooking_methods
        )
    )

    row["staple_types"] = (
        join_pipe(
            staple_types
        )
    )

    row["description"] = description

    row[
        "enrichment_status"
    ] = status

    return row


# ============================================================
# MAIN
# ============================================================

def main():

    if not INPUT_PATH.exists():

        print("❌ 파일이 없습니다:")
        print(INPUT_PATH)

        return

    print()
    print(
        "===================================="
    )
    print(
        "Food Master 자동 보강"
    )
    print(
        "===================================="
    )

    print()
    print(
        "입력:",
        INPUT_PATH
    )

    rows = []

    with open(
        INPUT_PATH,
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        reader = csv.DictReader(f)

        fieldnames = (
            reader.fieldnames
            or []
        )

        for row in reader:
            rows.append(
                enrich_row(row)
            )

    # 혹시 컬럼이 없으면 추가
    required_fields = [
        "name",
        "cuisine_type",
        "food_type",
        "main_ingredients",
        "sub_ingredients",
        "seasonings",
        "taste_tags",
        "cooking_methods",
        "staple_types",
        "aliases",
        "description",
        "source",
        "source_code",
        "enrichment_status",
    ]

    for field in required_fields:

        if field not in fieldnames:
            fieldnames.append(field)

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with open(
        OUTPUT_PATH,
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        for row in rows:
            writer.writerow(row)

    # 통계
    auto_count = sum(
        1
        for row in rows
        if row.get(
            "enrichment_status"
        ) == "auto"
    )

    review_count = sum(
        1
        for row in rows
        if row.get(
            "enrichment_status"
        ) == "review"
    )

    unknown_count = sum(
        1
        for row in rows
        if row.get(
            "enrichment_status"
        ) == "unknown"
    )

    print()
    print(
        "✅ 완료"
    )

    print()
    print(
        f"전체    : {len(rows):,}"
    )

    print(
        f"AUTO    : {auto_count:,}"
    )

    print(
        f"REVIEW  : {review_count:,}"
    )

    print(
        f"UNKNOWN : {unknown_count:,}"
    )

    print()
    print(
        "저장:"
    )

    print(
        OUTPUT_PATH
    )

    print()

    print(
        "===== 샘플 20개 ====="
    )

    for row in rows[:20]:

        print(
            f"{row['name']:<20} "
            f"{row.get('main_ingredients', ''):<20} "
            f"{row.get('food_type', ''):<10} "
            f"{row.get('enrichment_status', '')}"
        )


if __name__ == "__main__":
    main()