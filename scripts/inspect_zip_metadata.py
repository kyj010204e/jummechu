import zipfile
from pathlib import Path


DOWNLOADS = Path.home() / "Downloads"

zip_files = [
    p
    for p in DOWNLOADS.rglob("*.zip")
    if p.name == "[라벨]음식분류_TRAIN.zip"
]

if not zip_files:
    raise FileNotFoundError(
        "[라벨]음식분류_TRAIN.zip을 찾을 수 없습니다."
    )

ZIP_PATH = zip_files[0]

print("ZIP:", ZIP_PATH)
print()


with zipfile.ZipFile(ZIP_PATH, "r") as z:

    names = z.namelist()

    print("전체 파일 수:", len(names))
    print()

    print("===== XML이 아닌 파일 =====")

    non_xml = [
        name
        for name in names
        if not name.endswith("/")
        and not name.lower().endswith(".xml")
    ]

    for name in non_xml:
        print(name)

    print()
    print("XML 외 파일 수:", len(non_xml))

    print()
    print("===== 매핑파일 후보 =====")

    candidates = [
        name
        for name in names
        if name.lower().endswith(
            (
                ".txt",
                ".csv",
                ".json",
                ".xlsx",
                ".xls",
            )
        )
    ]

    for name in candidates:
        print(name)