export type PreferenceCategory = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  menus: readonly string[];
};

export const PREFERENCE_CATEGORIES =
  [
    {
      id: "rice",
      label: "밥류",
      emoji: "🍚",
      description: "볶음밥, 비빔밥, 덮밥, 국밥처럼 든든한 밥 메뉴",
      menus: [
        "김치볶음밥",
        "볶음밥",
        "일반비빔밥",
        "육회비빔밥",
        "제육덮밥",
        "불고기덮밥",
        "돼지국밥",
        "일반김밥",
      ],
    },
    {
      id: "noodle",
      label: "면류",
      emoji: "🍜",
      description: "라면부터 냉면, 국수, 칼국수, 우동까지",
      menus: [
        "라면",
        "물냉면",
        "비빔냉면",
        "잔치국수",
        "해물칼국수",
        "쌀국수",
        "일식우동",
        "쫄면",
      ],
    },
    {
      id: "meat",
      label: "고기류",
      emoji: "🥩",
      description: "불고기, 갈비, 수육처럼 고기가 중심인 메뉴",
      menus: [
        "불고기",
        "소불고기",
        "돼지갈비",
        "돼지고기수육",
        "족발",
        "닭갈비",
        "소갈비찜",
        "육회",
      ],
    },
    {
      id: "soup",
      label: "국물류",
      emoji: "🍲",
      description: "찌개, 탕, 국처럼 따뜻한 국물 메뉴",
      menus: [
        "된장찌개",
        "순두부찌개",
        "돼지고기김치찌개",
        "부대찌개",
        "감자탕",
        "갈비탕",
        "설렁탕",
        "육개장",
      ],
    },
    {
      id: "snack",
      label: "분식/튀김",
      emoji: "🍢",
      description: "떡볶이, 만두, 튀김처럼 가볍게 즐기는 메뉴",
      menus: [
        "떡볶이",
        "라볶이",
        "고기만두",
        "군만두",
        "김말이튀김",
        "새우튀김",
        "돈가스",
        "감자튀김",
      ],
    },
    {
      id: "chicken",
      label: "치킨류",
      emoji: "🍗",
      description: "튀김, 양념, 닭강정부터 찜닭까지",
      menus: [
        "양념치킨",
        "닭강정",
        "닭튀김",
        "치킨윙",
        "치킨데리야끼",
        "치킨가스",
        "찜닭",
        "닭꼬치",
      ],
    },
    {
      id: "japanese",
      label: "일식",
      emoji: "🍣",
      description: "초밥과 롤, 회덮밥 중심의 일식 메뉴",
      menus: [
        "연어초밥",
        "광어초밥",
        "새우초밥",
        "유부초밥",
        "장어초밥",
        "연어롤",
        "캘리포니아롤",
        "회덮밥",
      ],
    },
    {
      id: "chinese",
      label: "중식",
      emoji: "🥟",
      description: "짜장, 짬뽕부터 탕수육과 볶음요리까지",
      menus: [
        "자장면",
        "짬뽕",
        "삼선자장면",
        "삼선짬뽕",
        "탕수육",
        "깐풍기",
        "마파두부",
        "고추잡채",
      ],
    },
    {
      id: "western",
      label: "양식",
      emoji: "🍝",
      description: "파스타, 스테이크류와 서양식 메뉴",
      menus: [
        "오일소스스파게티",
        "크림소스스파게티",
        "토마토소스스파게티",
        "오므라이스",
        "햄버거스테이크",
        "생선가스",
        "치즈돈가스",
        "콘스프",
      ],
    },
    {
      id: "cafe",
      label: "간식/디저트",
      emoji: "🍡",
      description: "죽, 떡, 한과처럼 가볍고 달달한 메뉴",
      menus: [
        "전복죽",
        "팥죽",
        "호박죽",
        "채소죽",
        "약과",
        "인절미",
        "찹쌀떡",
        "송편",
      ],
    },
  ] as const satisfies readonly PreferenceCategory[];

export const MIN_DETAIL_PREFERENCES = 5;

export const ALL_PREFERENCE_MENU_NAMES =
  Array.from(
    new Set(
      PREFERENCE_CATEGORIES.flatMap(
        (category) => [...category.menus]
      )
    )
  );

export function getPreferenceCategoryIds(
  selectedMenus: readonly string[]
) {
  const selected = new Set(selectedMenus);

  return PREFERENCE_CATEGORIES
    .filter((category) =>
      category.menus.some((menu) => selected.has(menu))
    )
    .map((category) => category.id);
}
