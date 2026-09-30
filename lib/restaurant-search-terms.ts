export type RestaurantSearchTermKind =
  | "menu"
  | "alias"
  | "family"
  | "category";

export type RestaurantSearchSeed = {
  name: string;
  family: string;
  cuisineType?: string | null;
  foodType?: string | null;
  score: number;
};

export type RestaurantSearchTerm = {
  name: string;
  sourceMenu: string;
  score: number;
  kind: RestaurantSearchTermKind;
};

type BuildOptions = {
  exactLimit?: number;
  aliasLimit?: number;
  familyLimit?: number;
};

const EXCLUDED_FAMILIES = new Set([
  "기타",
  "밥",
  "국",
  "볶음",
  "구이",
  "튀김",
  "조림",
  "찜",
  "전",
  "무침",
  "떡",
  "면류",
]);


const CANONICAL_DISH_CORES = [
  "김치찌개",
  "된장찌개",
  "순두부찌개",
  "부대찌개",
  "청국장",
  "감자탕",
  "갈비탕",
  "설렁탕",
  "곰탕",
  "육개장",
  "닭볶음탕",
  "삼계탕",
  "닭갈비",
  "제육볶음",
  "제육",
  "불고기",
  "수육",
  "보쌈",
  "족발",
  "마파두부",
  "돈까스",
  "돈가스",
  "돈카츠",
  "카레",
  "볶음우동",
  "우동",
  "볶음밥",
  "비빔밥",
  "국밥",
  "칼국수",
  "냉면",
  "짜장면",
  "자장면",
  "짬뽕",
  "라멘",
  "라면",
  "초밥",
  "스시",
  "김밥",
  "파스타",
  "피자",
  "버거",
  "쌀국수",
  "팟타이",
  "분짜",
  "샤브샤브",
  "떡볶이",
] as const;

const SEARCH_NAME_MODIFIERS = [
  "돼지고기",
  "소고기",
  "쇠고기",
  "닭고기",
  "참치",
  "치즈",
  "매콤한",
  "매콤",
  "매운",
  "양념",
  "간장",
  "숯불",
  "직화",
  "크림",
  "로제",
] as const;

const COOKING_SUFFIXES = [
  "구이",
  "볶음",
  "조림",
  "찜",
  "튀김",
] as const;

const TOO_BROAD_CORES = new Set([
  "김치",
  "계란",
  "달걀",
  "치즈",
  "야채",
  "채소",
  "고기",
  "밥",
  "면",
]);

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function clean(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}


export function getCanonicalRestaurantSearchAlias(
  value: string
): string | null {
  const original = clean(value);
  const compact = original.replace(/\s+/g, "");

  if (!compact) {
    return null;
  }

  /*
   * Food Master에는 "돼지고기김치찌개", "치즈돈가스"처럼
   * 실제 NAVER 업체/메뉴 표기보다 세부적인 이름이 많이 있습니다.
   *
   * 추천/임베딩에서는 원본 이름을 그대로 사용하되,
   * 음식점 검색에서만 더 일반적으로 통용되는 대표 메뉴명을 하나 만듭니다.
   */
  for (const core of CANONICAL_DISH_CORES) {
    if (
      compact.includes(core) &&
      compact !== core
    ) {
      return core;
    }
  }

  let simplified = compact;

  for (const modifier of SEARCH_NAME_MODIFIERS) {
    if (
      simplified.startsWith(modifier) &&
      simplified.length > modifier.length + 1
    ) {
      simplified = simplified.slice(modifier.length);
      break;
    }
  }

  /*
   * 예: 고등어양념구이 -> 고등어구이
   *     쇠고기숙주볶음 -> 숙주볶음
   */
  for (const modifier of SEARCH_NAME_MODIFIERS) {
    const next = simplified.replace(modifier, "");

    if (
      next !== simplified &&
      next.length >= 2
    ) {
      simplified = next;
    }
  }

  if (
    simplified !== compact &&
    simplified.length >= 2 &&
    !TOO_BROAD_CORES.has(simplified)
  ) {
    return simplified;
  }

  for (const suffix of COOKING_SUFFIXES) {
    if (!compact.endsWith(suffix)) {
      continue;
    }

    const withoutStyleWords = compact
      .replace("양념", "")
      .replace("간장", "")
      .replace("매콤", "")
      .replace("매운", "")
      .replace("숯불", "")
      .replace("직화", "");

    if (
      withoutStyleWords !== compact &&
      withoutStyleWords.length >= suffix.length + 1
    ) {
      return withoutStyleWords;
    }
  }

  return null;
}

export function getSemanticRestaurantSearchAliases(
  value: string
) {
  const seed: RestaurantSearchSeed = {
    name: value,
    family: "",
    score: 0,
  };
  const name = clean(seed.name);
  const aliases: string[] = [];
  const seen = new Set<string>([name]);

  const add = (value: string) => {
    const query = clean(value);

    if (
      !query ||
      query.length < 2 ||
      seen.has(query)
    ) {
      return;
    }

    seen.add(query);
    aliases.push(query);
  };

  const canonical =
    getCanonicalRestaurantSearchAlias(
      name
    );

  if (canonical) {
    add(canonical);
  }

  /*
   * 메뉴명과 실제 매장 메뉴 표기가 다른 대표 사례.
   *
   * 제육덮밥을 좋아해도 음식점은
   * "제육", "제육볶음", "제육백반"으로 등록되는 경우가 많습니다.
   */
  if (name.includes("제육")) {
    add("제육");
    add("제육볶음");
    add("제육 백반");
  }

  if (
    name.includes("돈까스") ||
    name.includes("돈가스") ||
    name.includes("돈카츠")
  ) {
    add("돈까스");
    add("돈가스");
    add("돈카츠");
  }

  if (
    name.includes("짜장") ||
    name.includes("자장")
  ) {
    add("짜장면");
    add("자장면");
  }

  if (
    name.includes("쭈꾸미") ||
    name.includes("주꾸미")
  ) {
    add("쭈꾸미");
    add("주꾸미");
  }

  if (
    name.includes("오징어") &&
    name.includes("덮밥")
  ) {
    add("오징어볶음");
  }

  if (
    name.includes("낙지") &&
    name.includes("덮밥")
  ) {
    add("낙지볶음");
  }

  /*
   * 덮밥/정식/백반은 음식점 메뉴판에서
   * 핵심 재료명만 등록되는 경우가 많아 핵심어도 검색합니다.
   *
   * 제육덮밥 -> 제육
   * 불고기덮밥 -> 불고기
   * 연어덮밥 -> 연어
   */
  const coreSuffixes = [
    "덮밥",
    "정식",
    "백반",
  ];

  for (const suffix of coreSuffixes) {
    if (!name.endsWith(suffix)) {
      continue;
    }

    const core = clean(
      name.slice(
        0,
        name.length - suffix.length
      )
    );

    if (
      core.length >= 2 &&
      !TOO_BROAD_CORES.has(core)
    ) {
      add(core);
    }
  }

  return aliases;
}

export function buildExpandedRestaurantSearchTerms(
  seeds: RestaurantSearchSeed[],
  options: BuildOptions = {}
): RestaurantSearchTerm[] {
  const exactLimit =
    options.exactLimit ?? 8;

  const aliasLimit =
    options.aliasLimit ?? 6;

  const familyLimit =
    options.familyLimit ?? 6;

  const result: RestaurantSearchTerm[] = [];
  const seenQueries = new Set<string>();

  const preferred = seeds.filter(
    (item) => item.family !== "밥"
  );

  const combined = [
    ...preferred,
    ...seeds,
  ];

  let exactCount = 0;

  for (const item of combined) {
    const query = clean(item.name);

    if (
      !query ||
      seenQueries.has(query)
    ) {
      continue;
    }

    seenQueries.add(query);

    result.push({
      name: query,
      sourceMenu: item.name,
      score: clamp(item.score, 0, 100),
      kind: "menu",
    });

    exactCount++;

    if (exactCount >= exactLimit) {
      break;
    }
  }

  /*
   * 핵심 수정:
   * 정확 메뉴명과 family 사이에 "의미 별칭" 검색을 둡니다.
   *
   * 예:
   * 제육덮밥 -> 제육 / 제육볶음 / 제육 백반
   *
   * 별칭으로 발견된 매장은 정확 일치보다 약간 낮은 신뢰도만 주고,
   * 이후 실제 거리 점수와 합쳐 최종 정렬합니다.
   */
  let aliasCount = 0;

  /*
   * 첫 번째 추천 메뉴의 별칭만 여러 개 소비하지 않도록
   * 메뉴별 별칭을 round-robin으로 섞습니다.
   *
   * 예: 8개 alias 슬롯이면
   * 각 상위 메뉴의 대표 검색명부터 한 번씩 시도한 뒤
   * 남는 슬롯에 두 번째 별칭을 넣습니다.
   */
  const aliasGroups =
    seeds.map((item) => ({
      item,
      aliases:
        getSemanticRestaurantSearchAliases(
          item.name
        ),
    }));

  const maxAliasDepth =
    aliasGroups.reduce(
      (max, group) =>
        Math.max(
          max,
          group.aliases.length
        ),
      0
    );

  for (
    let aliasIndex = 0;
    aliasIndex < maxAliasDepth &&
    aliasCount < aliasLimit;
    aliasIndex += 1
  ) {
    for (const group of aliasGroups) {
      const alias =
        group.aliases[aliasIndex];

      if (
        !alias ||
        seenQueries.has(alias)
      ) {
        continue;
      }

      seenQueries.add(alias);

      result.push({
        name: alias,
        sourceMenu: group.item.name,
        score: clamp(
          group.item.score - 4,
          0,
          100
        ),
        kind: "alias",
      });

      aliasCount++;

      if (aliasCount >= aliasLimit) {
        break;
      }
    }
  }

  let familyCount = 0;
  const seenFamilies = new Set<string>();

  for (const item of seeds) {
    const family = clean(item.family);

    if (
      !family ||
      EXCLUDED_FAMILIES.has(family) ||
      seenFamilies.has(family) ||
      seenQueries.has(family)
    ) {
      continue;
    }

    seenFamilies.add(family);
    seenQueries.add(family);

    result.push({
      name: family,
      sourceMenu: item.name,
      score: clamp(item.score - 7, 0, 100),
      kind: "family",
    });

    familyCount++;

    if (familyCount >= familyLimit) {
      break;
    }
  }

  return result;
}
