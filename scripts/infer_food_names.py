import csv
import json
import re
from pathlib import Path
from collections import defaultdict, Counter


# ============================================================
# 경로
# ============================================================

ROOT = Path(
    r"C:\Users\301-03\Downloads\038.음식 3D 데이터"
    r"\3.개방데이터\1.데이터\Sublabel\SbL\02.라벨링데이터"
)

OUTPUT = Path(
    r"C:\project\project\data\aihub_food_name_candidates.csv"
)


# ============================================================
# 음식 이름에서 자주 나타나는 형태
# ============================================================

FOOD_SUFFIXES = (
    "찌개",
    "볶음",
    "국",
    "탕",
    "전골",
    "죽",
    "밥",
    "덮밥",
    "볶음밥",
    "비빔밥",
    "국밥",
    "면",
    "라면",
    "우동",
    "소바",
    "짬뽕",
    "짜장면",
    "냉면",
    "칼국수",
    "국수",
    "파스타",
    "스파게티",
    "피자",
    "버거",
    "햄버거",
    "샌드위치",
    "샐러드",
    "스테이크",
    "돈까스",
    "돈가스",
    "튀김",
    "구이",
    "찜",
    "조림",
    "전",
    "만두",
    "김밥",
    "초밥",
    "스시",
    "떡볶이",
    "카레",
    "커리",
    "케이크",
    "빵",
    "쿠키",
    "아이스크림",
)


# ============================================================
# 음식명이 아닌 단어
# ============================================================

STOPWORDS = {
    "그릇",
    "접시",
    "보울",
    "볼",
    "쟁반",
    "식탁",
    "테이블",
    "수저",
    "수저세트",
    "숟가락",
    "젓가락",
    "포크",
    "나이프",
    "컵",
    "잔",
    "냅킨",

    "갈색",
    "노란색",
    "빨간색",
    "붉은색",
    "초록색",
    "녹색",
    "흰색",
    "하얀색",
    "검은색",
    "검정색",
    "주황색",

    "옅은",
    "짙은",
    "진한",
    "밝은",
    "어두운",

    "음식",
    "요리",
    "고명",
    "소스",
    "육수",

    "있다",
    "있는",
    "담긴",
    "올라간",
    "들어간",
    "놓인",
    "곁들여진",
}


# ============================================================
# 조사 제거
#
# 전복죽이 -> 전복죽
# 김치찌개가 -> 김치찌개
# 제육볶음을 -> 제육볶음
# ============================================================

PARTICLES = (
    "으로부터",
    "에서부터",
    "에게서",
    "까지",
    "부터",
    "처럼",
    "보다",
    "으로",
    "에게",
    "에서",
    "한테",
    "하고",
    "이라",
    "라고",
    "이며",
    "이나",
    "는",
    "은",
    "이",
    "가",
    "을",
    "를",
    "와",
    "과",
    "에",
    "로",
    "도",
    "만",
    "의",
)


def remove_particle(word: str) -> str:

    for particle in PARTICLES:

        if (
            word.endswith(particle)
            and len(word) > len(particle) + 1
        ):
            return word[:-len(particle)]

    return word


# ============================================================
# Token 정규화
# ============================================================

def normalize_word(word: str) -> str:

    # 한글/영문/숫자만 유지
    word = re.sub(
        r"[^가-힣A-Za-z0-9]",
        "",
        word,
    )

    word = remove_particle(word)

    return word.strip()


# ============================================================
# Caption Tokenize
# ============================================================

def tokenize_caption(text: str):

    # 쉼표도 구분자로 사용
    raw_words = re.split(
        r"[\s,./()+\-]+",
        text
    )

    result = []

    for raw in raw_words:

        word = normalize_word(raw)

        if not word:
            continue

        if len(word) < 2:
            continue

        if word in STOPWORDS:
            continue

        result.append(word)

    return result


# ============================================================
# JSON caption 읽기
#
# 기존 데이터 중 14개 깨진 JSON도 있었기 때문에
# 최대한 복구한다.
# ============================================================

def read_caption(path: Path):

    try:

        raw = path.read_bytes()

        # 정상 파일
        try:

            text = raw.decode(
                "utf-8-sig"
            )

            data = json.loads(text)

            caption = str(
                data.get(
                    "text",
                    ""
                )
            ).strip()

            return caption

        except (
            UnicodeDecodeError,
            json.JSONDecodeError
        ):
            pass

        # 깨진 파일 복구
        text = raw.decode(
            "utf-8",
            errors="ignore"
        )

        match = re.search(
            r'"text"\s*:\s*"(.*)',
            text,
            flags=re.DOTALL,
        )

        if not match:
            return ""

        caption = match.group(1)

        caption = re.sub(
            r'"\s*}\s*$',
            "",
            caption,
        )

        return caption.strip()

    except Exception:

        return ""


# ============================================================
# 경로에서 food_code 찾기
#
# 예:
#
# KF / KF17 / 001 / ...
#
# ->
#
# KF17_001
# ============================================================

def get_food_code(path: Path):

    parts = path.relative_to(
        ROOT
    ).parts

    for i in range(
        len(parts) - 1
    ):

        category = parts[i]

        if not re.match(
            r"^[A-Z]+[0-9]+$",
            category
        ):
            continue

        number = parts[i + 1]

        if not number.isdigit():
            continue

        return (
            f"{category}_{number}"
        )

    return None


# ============================================================
# 음식 후보 점수
# ============================================================

def candidate_score(
    word,
    document_frequency,
    total_documents,
):

    score = float(
        document_frequency
    )

    # --------------------------------------------
    # 음식 이름 같은 접미사면 강한 가중치
    # --------------------------------------------

    if word.endswith(
        FOOD_SUFFIXES
    ):
        score *= 3.0

    # --------------------------------------------
    # 여러 caption에서 반복될수록 좋음
    # --------------------------------------------

    ratio = (
        document_frequency
        / max(total_documents, 1)
    )

    score += (
        ratio * 20
    )

    # --------------------------------------------
    # 지나치게 긴 문장은 제외
    # --------------------------------------------

    if len(word) > 15:
        score *= 0.3

    return score


# ============================================================
# MAIN
# ============================================================

def main():

    if not ROOT.exists():

        print(
            "❌ AI Hub 폴더를 찾을 수 없습니다."
        )

        print(ROOT)

        return

    captions_by_food = defaultdict(
        list
    )

    # ========================================================
    # 24,001 JSON 읽기
    # ========================================================

    for json_path in ROOT.rglob(
        "*.json"
    ):

        food_code = get_food_code(
            json_path
        )

        if not food_code:
            continue

        caption = read_caption(
            json_path
        )

        if not caption:
            continue

        captions_by_food[
            food_code
        ].append(
            caption
        )

    print(
        f"음식 코드: {len(captions_by_food)}개"
    )

    results = []

    # ========================================================
    # 음식 코드별 후보 추출
    # ========================================================

    for (
        food_code,
        captions
    ) in sorted(
        captions_by_food.items()
    ):

        # --------------------------------------------
        # document frequency
        #
        # 같은 caption 안에서 5번 나와도 1회로 계산
        # --------------------------------------------

        document_counter = Counter()

        for caption in captions:

            words = set(
                tokenize_caption(
                    caption
                )
            )

            document_counter.update(
                words
            )

        scored = []

        for (
            word,
            frequency
        ) in document_counter.items():

            if word in STOPWORDS:
                continue

            score = candidate_score(
                word,
                frequency,
                len(captions),
            )

            scored.append(
                (
                    word,
                    frequency,
                    score,
                )
            )

        scored.sort(
            key=lambda x: (
                x[2],
                x[1],
                len(x[0]),
            ),
            reverse=True,
        )

        # TOP 10
        top = scored[:10]

        def get_candidate(index):

            if index >= len(top):
                return "", 0, 0

            return top[index]

        c1 = get_candidate(0)
        c2 = get_candidate(1)
        c3 = get_candidate(2)
        c4 = get_candidate(3)
        c5 = get_candidate(4)

        results.append(
            {
                "food_code":
                    food_code,

                "caption_count":
                    len(captions),

                "candidate_1":
                    c1[0],

                "candidate_1_count":
                    c1[1],

                "candidate_1_score":
                    round(c1[2], 2),

                "candidate_2":
                    c2[0],

                "candidate_2_count":
                    c2[1],

                "candidate_2_score":
                    round(c2[2], 2),

                "candidate_3":
                    c3[0],

                "candidate_3_count":
                    c3[1],

                "candidate_3_score":
                    round(c3[2], 2),

                "candidate_4":
                    c4[0],

                "candidate_5":
                    c5[0],

                "sample_caption":
                    captions[0],
            }
        )

    # ========================================================
    # CSV 저장
    # ========================================================

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    fieldnames = [
        "food_code",
        "caption_count",

        "candidate_1",
        "candidate_1_count",
        "candidate_1_score",

        "candidate_2",
        "candidate_2_count",
        "candidate_2_score",

        "candidate_3",
        "candidate_3_count",
        "candidate_3_score",

        "candidate_4",
        "candidate_5",

        "sample_caption",
    ]

    with open(
        OUTPUT,
        "w",
        encoding="utf-8-sig",
        newline=""
    ) as file:

        writer = csv.DictWriter(
            file,
            fieldnames=fieldnames,
        )

        writer.writeheader()

        writer.writerows(
            results
        )

    # ========================================================
    # 출력
    # ========================================================

    print()
    print(
        "========================================"
    )

    print(
        "음식명 후보 추출 완료"
    )

    print(
        "========================================"
    )

    print(
        f"음식 코드 : {len(results)}"
    )

    print()

    print(
        f"CSV:"
    )

    print(
        OUTPUT
    )

    print()

    # 앞 20개 미리보기

    for row in results[:20]:

        print(
            row["food_code"],
            "→",
            row["candidate_1"],
            "/",
            row["candidate_2"],
            "/",
            row["candidate_3"],
        )


if __name__ == "__main__":
    main()