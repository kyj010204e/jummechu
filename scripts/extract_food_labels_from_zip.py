import csv
import zipfile
import xml.etree.ElementTree as ET

from collections import Counter
from pathlib import Path


# ============================================================
# ZIP 경로
# ============================================================

ZIP_PATH = Path(
    r"C:\Users\301-03\Downloads\음식 이미지 및 영양정보 텍스트\Training\[라벨]음식분류_TRAIN.zip"
)

OUTPUT_PATH = Path(
    r"C:\project\project\data\food_labels.csv"
)


# ============================================================
# 음식이 아닌 객체
# ============================================================

IGNORE_NAMES = {
    "dish",
    "spoon",
    "fork",
    "coin",
    "plate",
    "bowl",
}


def is_food_label(name: str):

    name = name.strip()

    if not name:
        return False

    if name.startswith("ref_"):
        return False

    if name.lower() in IGNORE_NAMES:
        return False

    return True


# ============================================================
# MAIN
# ============================================================

def main():

    if not ZIP_PATH.exists():

        print("❌ ZIP 파일이 없습니다.")
        print(ZIP_PATH)

        return

    food_counter = Counter()

    xml_count = 0
    error_count = 0

    print("ZIP 내부 XML 분석 시작...")
    print()

    with zipfile.ZipFile(
        ZIP_PATH,
        "r"
    ) as zip_file:

        files = zip_file.namelist()

        xml_files = [
            name
            for name in files
            if name.lower().endswith(".xml")
        ]

        print(
            f"XML 파일 수: {len(xml_files):,}"
        )

        for index, xml_name in enumerate(
            xml_files,
            start=1
        ):

            try:

                with zip_file.open(
                    xml_name
                ) as f:

                    xml_data = f.read()

                root = ET.fromstring(
                    xml_data
                )

                for obj in root.findall(
                    ".//object"
                ):

                    name_node = obj.find(
                        "name"
                    )

                    if name_node is None:
                        continue

                    name = (
                        name_node.text
                        or ""
                    ).strip()

                    if is_food_label(
                        name
                    ):

                        food_counter[
                            name
                        ] += 1

                xml_count += 1

            except Exception as e:

                error_count += 1

            if index % 10000 == 0:

                print(
                    f"{index:,}개 처리..."
                )

    # ========================================================
    # CSV 저장
    # ========================================================

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with open(
        OUTPUT_PATH,
        "w",
        encoding="utf-8-sig",
        newline=""
    ) as f:

        writer = csv.writer(
            f
        )

        writer.writerow(
            [
                "food_name",
                "image_count",
            ]
        )

        for (
            food_name,
            count
        ) in sorted(
            food_counter.items()
        ):

            writer.writerow(
                [
                    food_name,
                    count,
                ]
            )

    print()
    print(
        "===================================="
    )

    print(
        "음식 라벨 추출 완료"
    )

    print(
        "===================================="
    )

    print(
        f"처리 XML      : {xml_count:,}"
    )

    print(
        f"오류 XML      : {error_count:,}"
    )

    print(
        f"음식 종류     : {len(food_counter):,}"
    )

    print()

    print(
        "CSV:"
    )

    print(
        OUTPUT_PATH
    )

    print()

    print(
        "상위 30개:"
    )

    for (
        name,
        count
    ) in food_counter.most_common(
        30
    ):

        print(
            f"{name:<20} {count:,}"
        )


if __name__ == "__main__":
    main()