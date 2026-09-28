export type ParsedBusinessHour = {
  dayOfWeek: number;

  dayName: string;

  isClosed: boolean;

  openTime: string | null;

  closeTime: string | null;

  breakStartTime:
    string | null;

  breakEndTime:
    string | null;

  raw: string;
};


export type ParsedMenuPrice = {
  name: string;

  priceKrw: number;

  raw: string;
};


export type NaverPlaceParseResult = {
  businessHours:
    ParsedBusinessHour[];

  menus:
    ParsedMenuPrice[];

  warnings:
    string[];

  interestingLines:
    string[];
};


const DAY_MAP:
  Record<string, number> = {
    일: 0,
    월: 1,
    화: 2,
    수: 3,
    목: 4,
    금: 5,
    토: 6,
  };


const DAY_NAMES = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
];


function normalizeLine(
  value: unknown
) {

  return String(
    value ??
    ""
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function parseTimeRange(
  text: string
) {

  const match =
    normalizeLine(
      text
    ).match(
      /([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)/
    );


  if (!match) {
    return null;
  }


  const pad =
    (
      value: string
    ) =>
      value.padStart(
        2,
        "0"
      );


  return {
    start:
      `${pad(match[1])}:${match[2]}`,

    end:
      `${pad(match[3])}:${match[4]}`,
  };
}


function getAllTimeRanges(
  text: string
) {

  const ranges:
    Array<{
      start: string;
      end: string;
    }> = [];


  for (
    const match
    of normalizeLine(
      text
    ).matchAll(
      /([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)/g
    )
  ) {

    ranges.push({
      start:
        `${match[1].padStart(2, "0")}:${match[2]}`,

      end:
        `${match[3].padStart(2, "0")}:${match[4]}`,
    });
  }


  return ranges;
}


function parsePrice(
  text: string
) {

  const match =
    normalizeLine(
      text
    ).match(
      /(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원?/
    );


  if (!match) {
    return null;
  }


  const value =
    Number(
      match[1].replace(
        /,/g,
        ""
      )
    );


  if (
    !Number.isInteger(
      value
    ) ||
    value < 100 ||
    value >
      10_000_000
  ) {

    return null;
  }


  return value;
}


function isNoiseLine(
  line: string
) {

  const noise = [
    "홈",
    "소식",
    "메뉴",
    "예약",
    "리뷰",
    "사진",
    "지도",
    "저장",
    "길찾기",
    "공유",
    "출발",
    "도착",
    "거리뷰",
    "알림",
    "복사",
    "더보기",
    "영업시간",
  ];


  return noise.includes(
    line
  );
}


function looksLikeMenuName(
  line: string
) {

  if (
    !line ||
    isNoiseLine(
      line
    )
  ) {
    return false;
  }


  if (
    parsePrice(
      line
    ) !== null
  ) {
    return false;
  }


  if (
    parseTimeRange(
      line
    )
  ) {
    return false;
  }


  if (
    /영업|브레이크|라스트오더|휴무|매주|매일|주소|전화|예약|주문|수정 제안|편의|정보/.test(
      line
    )
  ) {
    return false;
  }


  if (
    /^[일월화수목금토]요일?$/.test(
      line
    )
  ) {
    return false;
  }


  return (
    line.length >= 1 &&
    line.length <= 60
  );
}


function findCommonBreakTime(
  lines: string[]
) {

  for (
    const line
    of lines
  ) {

    if (
      !/브레이크/.test(
        line
      )
    ) {
      continue;
    }


    const range =
      parseTimeRange(
        line
      );


    if (
      range
    ) {
      return range;
    }
  }


  return null;
}


function findWeeklyClosedDays(
  lines: string[]
) {

  const closedDays =
    new Set<number>();


  for (
    const line
    of lines
  ) {

    for (
      const match
      of line.matchAll(
        /매주\s*([일월화수목금토])요일/g
      )
    ) {

      const day =
        DAY_MAP[
          match[1]
        ];


      if (
        day !==
        undefined
      ) {

        closedDays.add(
          day
        );
      }
    }
  }


  return closedDays;
}


function parseBusinessHours(
  lines: string[]
) {

  const rows =
    new Map<
      number,
      ParsedBusinessHour
    >();


  const commonBreak =
    findCommonBreakTime(
      lines
    );


  for (
    let i = 0;
    i <
      lines.length;
    i += 1
  ) {

    const line =
      lines[i];


    const match =
      line.match(
        /^([일월화수목금토])(?:요일)?(?:\s+|$)(.*)$/
      );


    if (!match) {
      continue;
    }


    const dayName =
      match[1];


    const dayOfWeek =
      DAY_MAP[
        dayName
      ];


    const rest =
      normalizeLine(
        match[2]
      );


    if (
      /휴무/.test(
        rest
      )
    ) {

      rows.set(
        dayOfWeek,
        {
          dayOfWeek,

          dayName,

          isClosed:
            true,

          openTime:
            null,

          closeTime:
            null,

          breakStartTime:
            null,

          breakEndTime:
            null,

          raw:
            line,
        }
      );

      continue;
    }


    let sourceText =
      rest;


    let ranges =
      getAllTimeRanges(
        sourceText
      );


    /*
     * "화"
     * "11:00 - 22:00"
     * 처럼 다음 줄에 시간이 있는 형태도 처리합니다.
     */
    if (
      ranges.length ===
        0 &&
      lines[i + 1]
    ) {

      sourceText =
        lines[i + 1];

      ranges =
        getAllTimeRanges(
          sourceText
        );
    }


    if (
      ranges.length ===
      0
    ) {

      continue;
    }


    const openRange =
      ranges[0];


    let breakRange:
      {
        start: string;
        end: string;
      } | null =
        null;


    if (
      ranges.length >=
        2 &&
      /브레이크/.test(
        `${rest} ${sourceText}`
      )
    ) {

      breakRange =
        ranges[1];

    } else {

      const nearby =
        [
          lines[i + 1],
          lines[i + 2],
          lines[i + 3],
        ]
          .filter(
            (
              value
            ): value is string =>
              Boolean(
                value
              )
          );


      const nearbyBreak =
        nearby.find(
          (value) =>
            /브레이크/.test(
              value
            )
        );


      if (
        nearbyBreak
      ) {

        breakRange =
          parseTimeRange(
            nearbyBreak
          );
      }
    }


    /*
     * 요일별 브레이크타임을 못 찾았으면
     * 전체 공통 브레이크타임을 사용합니다.
     */
    if (
      !breakRange
    ) {

      breakRange =
        commonBreak;
    }


    rows.set(
      dayOfWeek,
      {
        dayOfWeek,

        dayName,

        isClosed:
          false,

        openTime:
          openRange.start,

        closeTime:
          openRange.end,

        breakStartTime:
          breakRange
            ?.start ??
            null,

        breakEndTime:
          breakRange
            ?.end ??
            null,

        raw:
          `${line}${
            sourceText &&
            sourceText !==
              rest
              ? ` ${sourceText}`
              : ""
          }`,
      }
    );
  }


  /*
   * "정기휴무 (매주 월요일)"
   * "오늘 휴무매주 월요일 휴무"
   * 같은 표현을 최종적으로 덮어씁니다.
   */
  const weeklyClosedDays =
    findWeeklyClosedDays(
      lines
    );


  for (
    const dayOfWeek
    of weeklyClosedDays
  ) {

    rows.set(
      dayOfWeek,
      {
        dayOfWeek,

        dayName:
          DAY_NAMES[
            dayOfWeek
          ],

        isClosed:
          true,

        openTime:
          null,

        closeTime:
          null,

        breakStartTime:
          null,

        breakEndTime:
          null,

        raw:
          `매주 ${
            DAY_NAMES[
              dayOfWeek
            ]
          }요일 휴무`,
      }
    );
  }


  return Array.from(
    rows.values()
  ).sort(
    (
      a,
      b
    ) =>
      a.dayOfWeek -
      b.dayOfWeek
  );
}


function parseMenus(
  lines: string[]
) {

  const menus:
    ParsedMenuPrice[] =
      [];


  const seen =
    new Set<string>();


  function addMenu(
    name: string,
    priceKrw: number,
    raw: string
  ) {

    const normalizedName =
      normalizeLine(
        name
      )
        .replace(
          /\s+\d{1,3}(?:,\d{3})+\s*원?.*$/,
          ""
        )
        .trim();


    if (
      !looksLikeMenuName(
        normalizedName
      )
    ) {
      return;
    }


    const key =
      `${normalizedName}::${priceKrw}`;


    if (
      seen.has(
        key
      )
    ) {
      return;
    }


    seen.add(
      key
    );


    menus.push({
      name:
        normalizedName,

      priceKrw,

      raw,
    });
  }


  for (
    let i = 0;
    i <
      lines.length;
    i += 1
  ) {

    const line =
      lines[i];


    const price =
      parsePrice(
        line
      );


    if (
      price ===
      null
    ) {
      continue;
    }


    const sameLineName =
      line
        .replace(
          /(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원?.*$/,
          ""
        )
        .trim();


    if (
      looksLikeMenuName(
        sameLineName
      )
    ) {

      addMenu(
        sameLineName,
        price,
        line
      );

      continue;
    }


    const previous =
      lines[
        i - 1
      ];


    if (
      previous &&
      looksLikeMenuName(
        previous
      )
    ) {

      addMenu(
        previous,
        price,
        `${previous} ${line}`
      );
    }
  }


  return menus;
}


export function parseNaverPlaceText(
  rawText: string
):
  NaverPlaceParseResult {

  const lines =
    rawText
      .split(
        /\r?\n/
      )
      .map(
        normalizeLine
      )
      .filter(
        Boolean
      );


  const businessHours =
    parseBusinessHours(
      lines
    );


  const menus =
    parseMenus(
      lines
    );


  const warnings:
    string[] = [];


  if (
    businessHours.length ===
      0
  ) {

    warnings.push(
      "영업시간을 찾지 못했습니다."
    );

  } else if (
    businessHours.length <
      7
  ) {

    const parsedDays =
      new Set(
        businessHours.map(
          (item) =>
            item.dayOfWeek
        )
      );


    const missing =
      DAY_NAMES.filter(
        (
          _,
          index
        ) =>
          !parsedDays.has(
            index
          )
      );


    warnings.push(
      `영업시간이 없는 요일: ${missing.join(", ")}`
    );
  }


  if (
    menus.length ===
      0
  ) {

    warnings.push(
      "메뉴 가격을 찾지 못했습니다."
    );
  }


  const interestingLines =
    lines
      .filter(
        (line) =>
          /영업|브레이크|라스트오더|휴무|원$|원\s/.test(
            line
          )
      )
      .slice(
        0,
        200
      );


  return {
    businessHours,

    menus,

    warnings,

    interestingLines,
  };
}
