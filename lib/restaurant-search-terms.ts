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

  for (const item of seeds) {
    for (const alias of getSemanticRestaurantSearchAliases(item.name)) {
      if (seenQueries.has(alias)) {
        continue;
      }

      seenQueries.add(alias);

      result.push({
        name: alias,
        sourceMenu: item.name,
        score: clamp(item.score - 4, 0, 100),
        kind: "alias",
      });

      aliasCount++;

      if (aliasCount >= aliasLimit) {
        break;
      }
    }

    if (aliasCount >= aliasLimit) {
      break;
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
