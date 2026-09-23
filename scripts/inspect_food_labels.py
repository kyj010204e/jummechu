import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


ZIP_PATH = Path(
    r"C:\Users\301-03\Downloads\음식 이미지 및 영양정보 텍스트\Training\[라벨]음식분류_TRAIN.zip"
)


def main():

    with zipfile.ZipFile(ZIP_PATH, "r") as z:

        xml_files = [
            x for x in z.namelist()
            if x.lower().endswith(".xml")
        ]

        print("XML 수:", len(xml_files))
        print()

        shown = 0

        for xml_name in xml_files:

            try:
                with z.open(xml_name) as f:
                    root = ET.fromstring(f.read())

                folder = root.findtext("folder", "")
                filename = root.findtext("filename", "")
                path = root.findtext("path", "")

                names = []

                for obj in root.findall(".//object"):
                    name = obj.findtext("name", "").strip()

                    if name:
                        names.append(name)

                # 숫자 클래스가 있는 XML만 확인
                if any(name.isdigit() for name in names):

                    print("=" * 70)
                    print("ZIP 경로 :", xml_name)
                    print("folder   :", folder)
                    print("filename :", filename)
                    print("path     :", path)
                    print("objects  :", names)
                    print()

                    shown += 1

                    if shown >= 15:
                        break

            except Exception:
                continue


if __name__ == "__main__":
    main()