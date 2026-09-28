import fs from "node:fs";
import path from "node:path";

const DAY_MAP = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function normalize(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimeRange(text) {
  const match = normalize(text).match(
    /([01]?\d|2[0-3]):([0-5]\d)\s*(?:~|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)/
  );

  if (!match) {
    return null;
  }

  const pad = (value) =>
    String(value).padStart(2, "0");

  return {
    start: `${pad(match[1])}:${match[2]}`,
    end: `${pad(match[3])}:${match[4]}`,
  };
}

function parsePrice(text) {
  const match = normalize(text).match(
    /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/
  );

  if (!match) {
    return null;
  }

  const price =
    Number(
      match[1].replace(/,/g, "")
    );

  if (
    !Number.isInteger(price) ||
    price < 100 ||
    price > 10000000
  ) {
    return null;
  }

  return price;
}

function looksLikeMenuName(text) {
  const line = normalize(text);

  if (!line) return false;
  if (parsePrice(line) !== null) return false;
  if (parseTimeRange(line)) return false;

  if (
    /영업|브레이크|라스트오더|휴무|매주|매일|주소|전화|예약|주문/.test(
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

  return line.length <= 60;
}

function parseMenus(lines) {
  const menus = [];
  const seen = new Set();

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    const line =
      lines[i];

    const price =
      parsePrice(line);

    if (
      price === null
    ) {
      continue;
    }

    const sameLineName =
      line
        .replace(
          /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원.*$/,
          ""
        )
        .trim();

    let menuName = null;

    if (
      looksLikeMenuName(
        sameLineName
      )
    ) {
      menuName =
        sameLineName;

    } else if (
      i > 0 &&
      looksLikeMenuName(
        lines[i - 1]
      )
    ) {
      menuName =
        lines[i - 1];
    }

    if (!menuName) {
      continue;
    }

    const key =
      `${menuName}:${price}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    menus.push({
      name:
        menuName,

      priceKrw:
        price,
    });
  }

  return menus;
}

function parseBusinessHours(
  lines
) {
  const days = [];

  for (
    let i = 0;
    i < lines.length;
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

    const rest =
      normalize(
        match[2]
      );

    if (
      /휴무/.test(
        rest
      )
    ) {
      days.push({
        dayOfWeek:
          DAY_MAP[
            dayName
          ],

        dayName,

        isClosed:
          true,
      });

      continue;
    }

    let range =
      parseTimeRange(
        rest
      );

    if (
      !range &&
      lines[i + 1]
    ) {
      range =
        parseTimeRange(
          lines[i + 1]
        );
    }

    if (range) {
      days.push({
        dayOfWeek:
          DAY_MAP[
            dayName
          ],

        dayName,

        isClosed:
          false,

        openTime:
          range.start,

        closeTime:
          range.end,
      });
    }
  }

  return days;
}

const inputPath =
  process.argv[2];

if (!inputPath) {
  console.error(
    '사용법: node .\\scripts\\naver_place_text_test.mjs ".\\naver_place_sample.txt"'
  );

  process.exit(1);
}

const absolutePath =
  path.resolve(
    inputPath
  );

if (
  !fs.existsSync(
    absolutePath
  )
) {
  console.error(
    `파일 없음: ${absolutePath}`
  );

  process.exit(1);
}

const raw =
  fs.readFileSync(
    absolutePath,
    "utf8"
  );

const lines =
  raw
    .split(/\r?\n/)
    .map(normalize)
    .filter(Boolean);

const result = {
  businessHours:
    parseBusinessHours(
      lines
    ),

  menus:
    parseMenus(
      lines
    ),

  debugLines:
    lines.filter(
      (line) =>
        /영업|브레이크|휴무|원/.test(
          line
        )
    ),
};

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);