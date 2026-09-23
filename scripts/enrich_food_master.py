import csv
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

INPUT_PATH = PROJECT_ROOT / "data" / "food_master_seed.csv"
OUTPUT_PATH = PROJECT_ROOT / "data" / "food_master_enriched.csv"


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
        "밥",
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
    ("잡곡", [
        "잡곡",
    ]),

    ("보리", [
        "보리",
    ]),

    ("현미", [
        "현미",
    ]),

    ("흑미", [
        "흑미",
    ]),

    ("곤드레", [
        "곤드레",
    ]),

    ("밤", [
        "밤밥",
    ]),

    ("연근", [
        "연근밥",
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
    ("짓기", ["밥",]),
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
    # 음식유형 + 주재료가 명확하면 우선 AUTO
    if food_type and main_ingredients:
        return "auto"

    # 주재료 또는 음식유형 중 하나는 파악됨
    if food_type or main_ingredients:
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


# ============================================================
# 특정 음식 예외 규칙
# ============================================================

def make_rule(
    food_type,
    main_ingredients,
    cuisine_type="",
    cooking_methods=None,
    staple_types=None,
    taste_tags=None,
    status=None,
):
    return {
        "food_type": food_type,
        "main_ingredients": main_ingredients,
        "cuisine_type": cuisine_type,
        "cooking_methods": cooking_methods or [],
        "staple_types": staple_types or [],
        "taste_tags": taste_tags or [],
        "status": status,
    }


SPECIAL_FOOD_RULES = {

    # ========================================================
    # 밥 / 면
    # ========================================================

    "오므라이스": make_rule(
        "밥요리",
        ["쌀", "달걀"],
        "일식",
        ["볶음"],
        ["밥"],
    ),

    "카레라이스": make_rule(
        "덮밥",
        ["쌀", "카레"],
        "",
        ["끓임"],
        ["밥"],
    ),

    "하이라이스": make_rule(
        "덮밥",
        ["쌀", "하이라이스소스"],
        "",
        ["끓임"],
        ["밥"],
    ),

    "캘리포니아롤": make_rule(
        "롤",
        ["쌀", "김"],
        "퓨전",
        [],
        ["밥"],
    ),

    "간자장": make_rule(
        "자장면",
        ["면", "춘장"],
        "중식",
        ["볶음"],
        ["면"],
    ),

    "기스면": make_rule(
        "국수",
        ["면", "닭고기"],
        "중식",
        ["끓임"],
        ["면"],
    ),

    "삼선자장면": make_rule(
        "자장면",
        ["면", "춘장", "해산물"],
        "중식",
        ["볶음"],
        ["면"],
    ),

    "삼선짬뽕": make_rule(
        "짬뽕",
        ["면", "해산물"],
        "중식",
        ["끓임"],
        ["면"],
        ["매콤"],
    ),

    "수제비": make_rule(
        "수제비",
        ["밀가루"],
        "한식",
        ["끓임"],
    ),

    "자장면": make_rule(
        "자장면",
        ["면", "춘장"],
        "중식",
        ["볶음"],
        ["면"],
    ),

    "짬뽕": make_rule(
        "짬뽕",
        ["면", "해산물"],
        "중식",
        ["끓임"],
        ["면"],
        ["매콤"],
    ),

    "쫄면": make_rule(
        "국수",
        ["면"],
        "한식",
        ["비빔"],
        ["면"],
        ["매콤"],
    ),
    "불고기": make_rule(
        "구이",
        ["소고기"],
        "한식",
        ["구이"],
    ),

    "소불고기": make_rule(
        "구이",
        ["소고기"],
        "한식",
        ["구이"],
    ),

    "오리불고기": make_rule(
        "구이",
        ["오리고기"],
        "한식",
        ["구이"],
    ),

    "오삼불고기": make_rule(
        "볶음",
        ["오징어", "돼지고기"],
        "한식",
        ["볶음"],
    ),
    "탕수육": make_rule(
        "튀김",
        ["돼지고기"],
        "중식",
        ["튀김"],
    ),

    "탕평채": make_rule(
        "무침",
        ["청포묵"],
        "한식",
        ["무침"],
    ),

    # ========================================================
    # 국 / 고기 / 중식
    # ========================================================

    "토마토스프": make_rule(
        "스프",
        ["토마토"],
        "양식",
        ["끓임"],
    ),

    "육개장": make_rule(
        "국",
        ["소고기"],
        "한식",
        ["끓임"],
        [],
        ["매콤"],
    ),

    "참꼬막": make_rule(
        "해산물",
        ["꼬막"],
        "한식",
        status="review",
    ),

    "양념왕갈비": make_rule(
        "구이",
        ["갈비"],
        "한식",
        ["구이"],
        status="review",
    ),

    "동그랑땡": make_rule(
        "전",
        ["다진고기"],
        "한식",
        ["부침"],
    ),

    "햄부침": make_rule(
        "전",
        ["햄"],
        "한식",
        ["부침"],
    ),

    "고추잡채": make_rule(
        "볶음",
        ["돼지고기", "피망"],
        "중식",
        ["볶음"],
    ),

    "라볶이": make_rule(
        "떡볶이",
        ["떡", "라면"],
        "한식",
        ["끓임"],
        ["면"],
        ["매콤"],
    ),

    "생선가스": make_rule(
        "튀김",
        ["생선"],
        "",
        ["튀김"],
    ),

    "깐풍기": make_rule(
        "튀김",
        ["닭고기"],
        "중식",
        ["튀김", "볶음"],
    ),

    # ========================================================
    # 생채 / 묵 / 냉채
    # ========================================================

    "도라지생채": make_rule(
        "생채",
        ["도라지"],
        "한식",
        ["무침"],
    ),

    "도토리묵": make_rule(
        "묵",
        ["도토리"],
        "한식",
    ),

    "무생채": make_rule(
        "생채",
        ["무"],
        "한식",
        ["무침"],
    ),

    "무말랭이": make_rule(
        "무침",
        ["무"],
        "한식",
        ["무침"],
    ),

    "오이생채": make_rule(
        "생채",
        ["오이"],
        "한식",
        ["무침"],
    ),

    "상추겉절이": make_rule(
        "겉절이",
        ["상추"],
        "한식",
        ["무침"],
    ),

    "해파리냉채": make_rule(
        "냉채",
        ["해파리"],
        "중식",
        ["무침"],
    ),

    # ========================================================
    # 나물
    # ========================================================

    "콩나물": make_rule(
        "나물",
        ["콩나물"],
        "한식",
        ["무침"],
    ),

    "고구마줄기나물": make_rule(
        "나물",
        ["고구마줄기"],
        "한식",
        ["무침"],
    ),
    "가지나물": make_rule(
        "나물", ["가지"], "한식", ["무침"]
    ),

    "고사리나물": make_rule(
        "나물", ["고사리"], "한식", ["무침"]
    ),

    "도라지나물": make_rule(
        "나물", ["도라지"], "한식", ["무침"]
    ),

    "무나물": make_rule(
        "나물", ["무"], "한식", ["볶음"]
    ),

    "미나리나물": make_rule(
        "나물", ["미나리"], "한식", ["무침"]
    ),

    "숙주나물": make_rule(
        "나물", ["숙주"], "한식", ["무침"]
    ),

    "시금치나물": make_rule(
        "나물", ["시금치"], "한식", ["무침"]
    ),

    "취나물": make_rule(
        "나물", ["취나물"], "한식", ["무침"]
    ),

    "쥐치채": make_rule(
        "반찬",
        ["쥐치"],
        "한식",
        status="review",
    ),

    "잡채": make_rule(
        "볶음",
        ["당면"],
        "한식",
        ["볶음"],
        ["면"],
    ),

    # ========================================================
    # 김치
    # ========================================================

    "고들빼기": make_rule(
        "김치",
        ["고들빼기"],
        "한식",
        ["발효"],
        status="review",
    ),

    "깍두기": make_rule(
        "김치",
        ["무"],
        "한식",
        ["발효"],
    ),

    "동치미": make_rule(
        "김치",
        ["무"],
        "한식",
        ["발효"],
    ),

    "배추겉절이": make_rule(
        "겉절이",
        ["배추"],
        "한식",
        ["무침"],
    ),

    "오이소박이": make_rule(
        "김치",
        ["오이"],
        "한식",
        ["발효"],
    ),
    "갓김치": make_rule("김치", ["갓"], "한식", ["발효"]),
    "깻잎김치": make_rule("김치", ["깻잎"], "한식", ["발효"]),
    "나박김치": make_rule("김치", ["무", "배추"], "한식", ["발효"]),
    "배추김치": make_rule("김치", ["배추"], "한식", ["발효"]),
    "백김치": make_rule("김치", ["배추"], "한식", ["발효"]),
    "부추김치": make_rule("김치", ["부추"], "한식", ["발효"]),
    "열무김치": make_rule("김치", ["열무"], "한식", ["발효"]),
    "열무얼갈이김치": make_rule(
        "김치", ["열무", "얼갈이배추"], "한식", ["발효"]
    ),
    "총각김치": make_rule("김치", ["무"], "한식", ["발효"]),
    "파김치": make_rule("김치", ["파"], "한식", ["발효"]),

    # ========================================================
    # 장아찌 / 피클
    # ========================================================

    "마늘쫑장아찌": make_rule(
        "장아찌", ["마늘쫑"], "한식", ["절임"]
    ),

    "고추장아찌": make_rule(
        "장아찌", ["고추"], "한식", ["절임"]
    ),

    "깻잎장아찌": make_rule(
        "장아찌", ["깻잎"], "한식", ["절임"]
    ),

    "마늘장아찌": make_rule(
        "장아찌", ["마늘"], "한식", ["절임"]
    ),

    "무장아찌": make_rule(
        "장아찌", ["무"], "한식", ["절임"]
    ),

    "양파장아찌": make_rule(
        "장아찌", ["양파"], "한식", ["절임"]
    ),

    "오이지": make_rule(
        "장아찌", ["오이"], "한식", ["절임"]
    ),

    "무피클": make_rule(
        "피클", ["무"], "", ["절임"]
    ),

    "오이피클": make_rule(
        "피클", ["오이"], "", ["절임"]
    ),

    "단무지": make_rule(
        "절임",
        ["무"],
        "",
        ["절임"],
    ),

    # ========================================================
    # 젓갈 / 회
    # ========================================================

    "명란젓": make_rule(
        "젓갈",
        ["명란"],
        "한식",
        ["염장"],
    ),

    "생선물회": make_rule(
        "물회",
        ["생선"],
        "한식",
        ["비빔"],
    ),

    "육사시미": make_rule(
        "회",
        ["소고기"],
        "한식",
        ["생식"],
    ),
    "간장게장": make_rule(
        "게장", ["게"], "한식", ["절임"]
    ),

    "양념게장": make_rule(
        "게장", ["게"], "한식", ["양념"]
    ),

    "오징어젓갈": make_rule(
        "젓갈", ["오징어"], "한식", ["염장"]
    ),

    "생연어": make_rule(
        "회", ["연어"], "", ["생식"]
    ),

    "광어회": make_rule(
        "회", ["광어"], "한식", ["생식"]
    ),

    "훈제연어": make_rule(
        "훈제", ["연어"], "", ["훈제"]
    ),

    "육회": make_rule(
        "회", ["소고기"], "한식", ["생식"]
    ),

    # ========================================================
    # 떡
    # ========================================================

    "경단": make_rule(
        "떡",
        ["찹쌀"],
        "한식",
        ["삶기"],
        ["밥"],
    ),

    "백설기": make_rule(
        "떡",
        ["쌀"],
        "한식",
        ["찜"],
        ["밥"],
    ),

    "송편": make_rule(
        "떡",
        ["쌀"],
        "한식",
        ["찜"],
        ["밥"],
    ),

    "수수부꾸미": make_rule(
        "떡",
        ["수수"],
        "한식",
        ["부침"],
    ),

    "약식": make_rule(
        "떡",
        ["찹쌀"],
        "한식",
        ["찜"],
        ["밥"],
    ),

    "인절미": make_rule(
        "떡",
        ["찹쌀"],
        "한식",
        ["찜"],
        ["밥"],
    ),

    "절편": make_rule(
        "떡",
        ["쌀"],
        "한식",
        ["찜"],
        ["밥"],
    ),

    "증편": make_rule(
        "떡",
        ["쌀"],
        "한식",
        ["발효", "찜"],
        ["밥"],
    ),

    # ========================================================
    # 한과
    # ========================================================

    "매작과": make_rule(
        "한과",
        ["밀가루"],
        "한식",
        ["튀김"],
    ),

    "다식": make_rule(
        "한과",
        ["곡물가루"],
        "한식",
        status="review",
    ),

    "약과": make_rule(
        "한과",
        ["밀가루"],
        "한식",
        ["튀김"],
    ),

    "유과": make_rule(
        "한과",
        ["찹쌀"],
        "한식",
        ["튀김"],
    ),

    "산자": make_rule(
        "한과",
        ["찹쌀"],
        "한식",
        ["튀김"],
    ),

    "깨강정": make_rule(
        "한과",
        ["참깨"],
        "한식",
    ),
    "연어롤": make_rule(
        "롤", ["연어", "쌀"], "", [], ["밥"]
    ),

    "굴짬뽕": make_rule(
        "짬뽕", ["굴", "면"], "중식", ["끓임"], ["면"], ["매콤"]
    ),

    "콘스프": make_rule(
        "스프", ["옥수수"], "양식", ["끓임"]
    ),

    "닭개장": make_rule(
        "국", ["닭고기"], "한식", ["끓임"], [], ["매콤"]
    ),

    "문어숙회": make_rule(
        "숙회", ["문어"], "한식", ["삶기"]
    ),

    "돼지고기수육": make_rule(
        "수육", ["돼지고기"], "한식", ["삶기"]
    ),

    "족발": make_rule(
        "수육", ["돼지고기"], "한식", ["삶기"]
    ),

    "닭갈비": make_rule(
        "볶음", ["닭고기"], "한식", ["볶음"]
    ),

    "닭꼬치": make_rule(
        "꼬치", ["닭고기"], "", ["구이"]
    ),

    "돼지갈비": make_rule(
        "구이", ["돼지고기"], "한식", ["구이"]
    ),

    "훈제오리": make_rule(
        "훈제", ["오리고기"], "", ["훈제"]
    ),

    "치킨데리야끼": make_rule(
        "구이", ["닭고기"], "", ["구이"]
    ),

    "치킨윙": make_rule(
        "튀김", ["닭고기"], "", ["튀김"]
    ),

    "호박부침개": make_rule(
        "전", ["호박"], "한식", ["부침"]
    ),

    "달걀말이": make_rule(
        "전", ["달걀"], "한식", ["부침"]
    ),

    "두부부침": make_rule(
        "부침", ["두부"], "한식", ["부침"]
    ),

    "두부김치": make_rule(
        "반찬", ["두부", "김치"], "한식"
    ),

    "마파두부": make_rule(
        "볶음", ["두부"], "중식", ["볶음"], [], ["매콤"]
    ),

    "닭강정": make_rule(
        "튀김", ["닭고기"], "한식", ["튀김"]
    ),

    "돈가스": make_rule(
        "튀김", ["돼지고기"], "", ["튀김"]
    ),

    "치즈돈가스": make_rule(
        "튀김", ["돼지고기", "치즈"], "", ["튀김"]
    ),

    "치킨가스": make_rule(
        "튀김", ["닭고기"], "", ["튀김"]
    ),

    "양념치킨": make_rule(
        "튀김", ["닭고기"], "", ["튀김"]
    ),
}
# ============================================================
# 주재료 정확 보정
# ============================================================

MAIN_INGREDIENT_OVERRIDES = {
    # 냉면 / 만두
    "물냉면": ["면"],
    "비빔냉면": ["면"],
    "회냉면": ["면", "생선회"],
    "고기만두": ["밀가루", "다진고기"],
    "군만두": ["밀가루", "다진고기"],
    "물만두": ["밀가루", "다진고기"],
    "만둣국": ["만두"],

    # 국
    "미역국": ["미역"],
    "순대국": ["순대"],
    "어묵국": ["어묵"],
    "토란국": ["토란"],
    "탕국": ["소고기", "무"],
    "황태해장국": ["황태"],
    "근대된장국": ["근대", "된장"],
    "미소된장국": ["된장"],
    "배추된장국": ["배추", "된장"],
    "뼈다귀해장국": ["돼지등뼈"],
    "선지(해장)국": ["선지"],
    "시금치된장국": ["시금치", "된장"],
    "시래기된장국": ["시래기", "된장"],
    "쑥된장국": ["쑥", "된장"],
    "아욱된장국": ["아욱", "된장"],
    "우거지된장국": ["우거지", "된장"],
    "우거지해장국": ["우거지"],
    "우렁된장국": ["우렁", "된장"],

    # 탕
    "매운탕": ["생선"],
    "내장탕": ["내장"],
    "지리탕": ["생선"],
    "도가니탕": ["소고기", "도가니"],
    "알탕": ["생선알"],
    "연포탕": ["낙지"],
    "추어탕": ["미꾸라지"],
    "해물탕": ["해산물"],
    "뼈해장국": ["돼지등뼈"],

    # 냉국 / 찌개 / 전골
    "미역오이냉국": ["미역", "오이"],
    "동태찌개": ["동태"],
    "부대찌개": ["햄", "소시지"],
    "된장찌개": ["된장", "두부"],
    "청국장찌개": ["청국장", "두부"],
    "곱창전골": ["곱창"],
    "고추장찌개": ["고추장"],

    # 찜
    "대구찜": ["대구"],
    "도미찜": ["도미"],
    "아귀찜": ["아귀"],
    "해물찜": ["해산물"],
    "소갈비찜": ["소고기"],

    # 구이
    "소곱창구이": ["소곱창"],
    "소양념갈비구이": ["소고기"],
    "햄버거스테이크": ["다진고기"],
    "더덕구이": ["더덕"],
    "양배추구이": ["양배추"],
    "삼치구이": ["삼치"],

    # 전
    "가자미전": ["가자미"],
    "동태전": ["동태"],
    "해물파전": ["해산물", "파"],
    "육전": ["소고기"],
    "고추전": ["고추"],
    "깻잎전": ["깻잎"],
    "미나리전": ["미나리"],
    "배추전": ["배추"],
    "부추전": ["부추"],
    "야채전": ["채소"],
    "파전": ["파"],

    # 볶음
    "멸치볶음": ["멸치"],
    "어묵볶음": ["어묵"],
    "해물볶음": ["해산물"],
    "깻잎나물볶음": ["깻잎"],
    "머위나물볶음": ["머위"],
    "소세지볶음": ["소시지"],
    "순대볶음": ["순대"],

    # 조림
    "가자미조림": ["가자미"],
    "동태조림": ["동태"],
    "북어조림": ["북어"],
    "코다리조림": ["코다리"],
    "메추리알장조림": ["메추리알"],
    "고추조림": ["고추"],
    "우엉조림": ["우엉"],

    # 튀김
    "미꾸라지튀김": ["미꾸라지"],
    "쥐포튀김": ["쥐포"],
    "모래집튀김": ["닭모래집"],
    "고추튀김": ["고추"],
    "김말이튀김": ["김", "당면"],
    "채소튀김": ["채소"],

    # 무침
    "노각무침": ["노각"],
    "단무지무침": ["단무지"],
    "달래나물무침": ["달래"],
    "더덕무침": ["더덕"],
    "마늘쫑무침": ["마늘쫑"],
    "파무침": ["파"],
    "쑥갓나물무침": ["쑥갓"],
    "청포묵무침": ["청포묵"],
    "우거지나물무침": ["우거지"],
    "골뱅이무침": ["골뱅이"],
    "김무침": ["김"],
    "미역초무침": ["미역"],
    "북어채무침": ["북어"],
    "회무침": ["생선회"],
    "파래무침": ["파래"],
    "홍어무침": ["홍어"],

    # 기존 추론 보정
    "콩나물": ["콩나물"],
    "고구마줄기나물": ["고구마줄기"],
    
}

MAIN_INGREDIENT_OVERRIDES.update({
    "샐러드김밥": ["채소", "쌀"],

    "떡라면": ["떡", "면"],

    "떡국": ["떡"],
    "떡만둣국": ["떡", "만두"],

    "깨죽": ["깨", "쌀"],
    "어죽": ["생선", "쌀"],
    "채소죽": ["채소", "쌀"],

    "떡볶이": ["떡"],
    
    # 밥류
    "삼선볶음밥": ["해산물", "쌀"],
    "알밥": ["생선알", "쌀"],
    "산채비빔밥": ["산채", "쌀"],
    "해물볶음밥": ["해산물", "쌀"],
    "열무비빔밥": ["열무", "쌀"],
    "불고기덮밥": ["소고기", "쌀"],
    "자장밥": ["춘장", "쌀"],
    "잡채밥": ["당면", "쌀"],
    "장어덮밥": ["장어", "쌀"],
    "짬뽕밥": ["해산물", "쌀"],
    "순대국밥": ["순대", "쌀"],
    "해물덮밥": ["해산물", "쌀"],
    "회덮밥": ["생선회", "쌀"],
    "소머리국밥": ["소고기", "쌀"],

    # 초밥 / 김밥
    "농어초밥": ["농어", "쌀"],
    "광어초밥": ["광어", "쌀"],
    "갈비삼각김밥": ["소고기", "쌀"],
    "연어초밥": ["연어", "쌀"],
    "유부초밥": ["유부", "쌀"],
    "장어초밥": ["장어", "쌀"],
    "참치김밥": ["참치", "쌀"],
    "참치마요삼각김밥": ["참치", "마요네즈", "쌀"],
    "치즈김밥": ["치즈", "쌀"],
    "한치초밥": ["한치", "쌀"],

    # 면
    "들깨칼국수": ["들깨", "면"],
    "막국수": ["메밀", "면"],
    "삼선우동": ["해산물", "면"],
    "오일소스스파게티": ["올리브오일", "면"],
    "치즈라면": ["치즈", "면"],
    "크림소스스파게티": ["크림소스", "면"],
    "토마토소스스파게티": ["토마토", "면"],
    "해물칼국수": ["해산물", "면"],
    "짜장라면": ["춘장", "면"],
    "골뱅이국수무침": ["골뱅이", "면"],

    # 죽
    "게살죽": ["게살", "쌀"],
    "잣죽": ["잣", "쌀"],
    "참치죽": ["참치", "쌀"],

    # 생선 / 찌개 / 조림
    "고등어찌개": ["고등어"],
    "꽁치찌개": ["꽁치"],
    "조기찜": ["조기"],
    "갈치조림": ["갈치"],
    "고등어조림": ["고등어"],
    "꽁치조림": ["꽁치"],
    "조기조림": ["조기"],

    # 잘못 추론된 음식
    "떡갈비": ["다진고기"],
    "녹두빈대떡": ["녹두"],

    # 떡
    "찰떡": ["찹쌀"],
    "찹쌀떡": ["찹쌀"],
    "쑥떡": ["쑥", "쌀"],
})

def enrich_row(row):

    name = row.get("name", "").strip()
    special = SPECIAL_FOOD_RULES.get(
        name,
        {}
    )

    cuisine_type = (
        row.get("cuisine_type", "").strip()
        or special.get("cuisine_type", "")
        or infer_cuisine(name)
    )

    food_type = (
        row.get("food_type", "").strip()
        or special.get("food_type", "")
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

    special_main = special.get(
        "main_ingredients",
        []
    )
    override_main = MAIN_INGREDIENT_OVERRIDES.get(
        name,
        []
    )

    if override_main:
        # 정확한 음식명 기반 주재료 보정이 최우선
        main_ingredients = unique(
            existing_main
            + override_main
        )

    elif special_main:
        main_ingredients = unique(
            existing_main
            + special_main
        )

    else:
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
        + special.get(
            "cooking_methods",
            []
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
        + special.get(
            "staple_types",
            []
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
        + special.get(
            "taste_tags",
            []
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

    # ============================================================
    # REVIEW / UNKNOWN 별도 저장
    # ============================================================

    REVIEW_PATH = (
        PROJECT_ROOT
        / "data"
        / "food_master_needs_review.csv"
    )

    needs_review = [
        row
        for row in rows
        if row.get("enrichment_status")
        in ("review", "unknown")
    ]

    with open(
        REVIEW_PATH,
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
        )

        writer.writeheader()
        writer.writerows(needs_review)

    print()
    print(
        f"검토 대상 : {len(needs_review):,}"
    )

    print(
        "검토 CSV :"
    )

    print(
        REVIEW_PATH
    )

    # ============================================================
    # UNKNOWN 음식만 별도 저장
    # ============================================================

    UNKNOWN_PATH = (
        PROJECT_ROOT
        / "data"
        / "food_master_unknown.csv"
    )

    unknown_rows = [
        row
        for row in rows
        if row.get("enrichment_status") == "unknown"
    ]

    with open(
        UNKNOWN_PATH,
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames,
        )

        writer.writeheader()
        writer.writerows(unknown_rows)

    print()
    print(f"UNKNOWN 대상 : {len(unknown_rows):,}")

    print(
        "UNKNOWN CSV :"
    )

    print(
        UNKNOWN_PATH
    )

    print()
    print(
        "===== UNKNOWN 음식 ====="
    )

    for row in unknown_rows:
        print(row["name"])


if __name__ == "__main__":
    main()