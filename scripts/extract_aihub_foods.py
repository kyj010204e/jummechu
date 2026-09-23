import csv
import json
import re
from pathlib import Path
from collections import defaultdict


# ============================================================
# 경로
# ============================================================

ROOT = Path(
    r"C:\Users\301-03\Downloads\038.음식 3D 데이터\3.개방데이터\1.데이터\Sublabel\SbL"
)

OUTPUT = Path(
    r"C:\project\project\data\aihub_food_candidates.csv"
)


# ============================================================
# 음식 코드 패턴
#
# 예:
# KF05 / 005
# KF17 / 001
# ETC06 / 001
# ============================================================

CATEGORY_PATTERN = re.compile(
    r"^[A-Z]+[0-9]+$"
)

FOOD_NUMBER_PATTERN = re.compile(
    r"^[0-9]+$"
)


# ============================================================
# JSON에서 text 추출
#
# 정상 JSON이면 json.loads()
# 깨진 JSON이면 최대한 caption 복구
# ============================================================

def read_caption(json_path: Path):

    try:
        raw = json_path.read_bytes()

    except Exception:
        return None, "failed"

    # --------------------------------------------------------
    # 정상 UTF-8 JSON
    # --------------------------------------------------------

    try:
        text = raw.decode(
            "utf-8-sig"
        )

        data = json.loads(
            text
        )

        caption = str(
            data.get(
                "text",
                ""
            )
        ).strip()

        if caption:
            return caption, "normal"

    except (
        UnicodeDecodeError,
        json.JSONDecodeError
    ):
        pass

    # --------------------------------------------------------
    # 깨진 UTF-8 복구 시도
    # --------------------------------------------------------

    try:
        text = raw.decode(
            "utf-8",
            errors="ignore"
        )

        # {"text":"...."}
        #
        # 마지막 따옴표/괄호가 없어도
        # text 이후 내용을 최대한 가져옴

        match = re.search(
            r'"text"\s*:\s*"(.*)',
            text,
            flags=re.DOTALL,
        )

        if not match:
            return None, "failed"

        caption = (
            match.group(1)
            .strip()
        )

        # 정상적으로 끝난 경우
        # 뒤쪽 "} 제거
        caption = re.sub(
            r'"\s*}\s*$',
            "",
            caption,
        )

        # 흔한 escape 복구
        caption = (
            caption
            .replace(r"\"", '"')
            .replace(r"\n", " ")
            .replace(r"\r", " ")
            .replace(r"\t", " ")
            .strip()
        )

        if caption:
            return caption, "recovered"

    except Exception:
        pass

    return None, "failed"


# ============================================================
# 경로에서 음식 코드 찾기
#
# 어떤 깊이에 있든
#
# KF05 / 005
#
# 형태를 찾아냄
# ============================================================

def get_food_info(
    json_path: Path
):

    try:
        relative = (
            json_path.relative_to(
                ROOT
            )
        )

    except ValueError:
        return None

    parts = relative.parts

    for index in range(
        len(parts) - 1
    ):

        current = parts[index]

        if not CATEGORY_PATTERN.match(
            current
        ):
            continue

        if index + 1 >= len(parts):
            continue

        food_number = (
            parts[index + 1]
        )

        if not FOOD_NUMBER_PATTERN.match(
            food_number
        ):
            continue

        category_code = current

        # KF05 -> KF
        # ETC06 -> ETC

        super_match = re.match(
            r"^([A-Z]+)",
            category_code
        )

        super_category = (
            super_match.group(1)
            if super_match
            else ""
        )

        food_code = (
            f"{category_code}_"
            f"{food_number}"
        )

        return {
            "super_category":
                super_category,

            "category_code":
                category_code,

            "food_number":
                food_number,

            "food_code":
                food_code,
        }

    return None


# ============================================================
# MAIN
# ============================================================

def main():

    if not ROOT.exists():

        print(
            "❌ SbL 폴더를 찾을 수 없습니다."
        )

        print(
            ROOT
        )

        return

    foods = defaultdict(
        list
    )

    total_json = 0
    normal_count = 0
    recovered_count = 0
    failed_count = 0
    path_error_count = 0

    failed_files = []

    # ========================================================
    # JSON 전체 탐색
    # ========================================================

    for json_path in ROOT.rglob(
        "*.json"
    ):

        total_json += 1

        # ----------------------------------------------------
        # 음식 코드 추출
        # ----------------------------------------------------

        food_info = (
            get_food_info(
                json_path
            )
        )

        if not food_info:

            path_error_count += 1

            continue

        # ----------------------------------------------------
        # Caption
        # ----------------------------------------------------

        caption, status = (
            read_caption(
                json_path
            )
        )

        if status == "normal":

            normal_count += 1

        elif status == "recovered":

            recovered_count += 1

        else:

            failed_count += 1

            failed_files.append(
                str(json_path)
            )

            continue

        if not caption:
            continue

        foods[
            food_info[
                "food_code"
            ]
        ].append(
            {
                **food_info,
                "caption":
                    caption,
            }
        )

    # ========================================================
    # CSV 폴더
    # ========================================================

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    # ========================================================
    # CSV 저장
    # ========================================================

    with open(
        OUTPUT,
        "w",
        encoding="utf-8-sig",
        newline=""
    ) as file:

        writer = csv.writer(
            file
        )

        writer.writerow(
            [
                "food_code",
                "super_category",
                "category_code",
                "food_number",
                "caption_count",
                "sample_caption_1",
                "sample_caption_2",
                "sample_caption_3",
            ]
        )

        for food_code in sorted(
            foods.keys()
        ):

            items = foods[
                food_code
            ]

            captions = [
                item["caption"]
                for item in items
            ]

            first = items[0]

            writer.writerow(
                [
                    food_code,

                    first[
                        "super_category"
                    ],

                    first[
                        "category_code"
                    ],

                    first[
                        "food_number"
                    ],

                    len(captions),

                    (
                        captions[0]
                        if len(captions) > 0
                        else ""
                    ),

                    (
                        captions[1]
                        if len(captions) > 1
                        else ""
                    ),

                    (
                        captions[2]
                        if len(captions) > 2
                        else ""
                    ),
                ]
            )

    # ========================================================
    # 오류 파일 기록
    # ========================================================

    ERROR_FILE = (
        OUTPUT.parent
        / "aihub_failed_files.txt"
    )

    with open(
        ERROR_FILE,
        "w",
        encoding="utf-8"
    ) as file:

        for item in failed_files:

            file.write(
                item + "\n"
            )

    # ========================================================
    # 결과
    # ========================================================

    print()
    print(
        "========================================"
    )

    print(
        "AI Hub 음식 데이터 분석 결과"
    )

    print(
        "========================================"
    )

    print(
        f"전체 JSON          : {total_json}"
    )

    print(
        f"정상 JSON          : {normal_count}"
    )

    print(
        f"복구한 JSON        : {recovered_count}"
    )

    print(
        f"복구 실패 JSON     : {failed_count}"
    )

    print(
        f"경로 인식 실패     : {path_error_count}"
    )

    print()

    print(
        f"✅ 음식 코드 수     : {len(foods)}"
    )

    print()

    print(
        f"✅ CSV 저장:"
    )

    print(
        OUTPUT
    )

    if failed_count:

        print()

        print(
            "⚠️ 복구 실패 목록:"
        )

        print(
            ERROR_FILE
        )


if __name__ == "__main__":
    main()