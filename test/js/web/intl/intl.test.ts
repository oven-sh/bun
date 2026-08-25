// ECMA-402 Intl coverage. Doubles as the regression net for the per-item zstd
// repack of ICU's display-name trees (curr/ lang/ region/ unit/ zone/): every
// non-en case in DisplayNames / NumberFormat(unit|currencyDisplay:"name") /
// DateTimeFormat(timeZoneName) reads a zstd-decompressed item, while Collator /
// Segmenter / default DateTimeFormat / default NumberFormat / normalize stay raw.
//
// Snapshots are the ground truth: they capture uncompressed-ICU output. If a
// decompressed item is wrong, the snapshot diff shows exactly which locale/tree.
// When WEBKIT_VERSION bumps ICU/CLDR, regenerate with `-u` against a build that
// links the unmodified libicudata.a.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, libcPathForDlopen } from "harness";

// Snapshots are CLDR-version-specific. Only check them where Bun bundles the
// ICU they were generated against; macOS uses Apple's libicucore, so snapshot
// diffs there are expected and not a regression. The structural sweep below
// runs everywhere.
const SNAPSHOT_ICU_VERSION = "78.3";
const snapshotIf = !isMacOS && process.versions.icu === SNAPSHOT_ICU_VERSION ? test : test.skip;

const LOCALES = ["en", "de", "fr", "ja", "ko", "ru", "zh", "zh-Hant", "ar", "th", "es-419", "pt-PT"] as const;

// ---------------------------------------------------------------------------
// DisplayNames — region/ lang/ curr/ script (non-en compressed)
// ---------------------------------------------------------------------------

describe("Intl.DisplayNames", () => {
  for (const type of ["region", "language", "currency", "script"] as const) {
    const code = { region: "US", language: "en", currency: "USD", script: "Hant" }[type];
    snapshotIf(`${type}:'${code}' across locales`, () => {
      const out: Record<string, string | undefined> = {};
      for (const loc of LOCALES) out[loc] = new Intl.DisplayNames(loc, { type }).of(code);
      expect(out).toMatchSnapshot();
    });
  }

  snapshotIf("a few more region codes", () => {
    const out: Record<string, Record<string, string | undefined>> = {};
    for (const code of ["DE", "JP", "BR", "419"]) {
      out[code] = {};
      for (const loc of LOCALES) out[code][loc] = new Intl.DisplayNames(loc, { type: "region" }).of(code);
    }
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// NumberFormat — default/currency-symbol raw; unit + currencyDisplay:"name" compressed
// ---------------------------------------------------------------------------

describe("Intl.NumberFormat", () => {
  snapshotIf("default grouping", () => {
    const out: Record<string, string> = {};
    for (const loc of LOCALES) out[loc] = new Intl.NumberFormat(loc).format(1234567.89);
    expect(out).toMatchSnapshot();
  });

  snapshotIf("currency symbol", () => {
    const out: Record<string, string> = {};
    for (const loc of LOCALES)
      out[loc] = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR" }).format(1234.56);
    expect(out).toMatchSnapshot();
  });

  snapshotIf("currencyDisplay:'name' (curr/<loc>.res)", () => {
    const out: Record<string, string> = {};
    for (const loc of LOCALES)
      out[loc] = new Intl.NumberFormat(loc, { style: "currency", currency: "USD", currencyDisplay: "name" }).format(2);
    expect(out).toMatchSnapshot();
  });

  snapshotIf("style:'unit' (unit/<loc>.res; ru is the largest item)", () => {
    const out: Record<string, Record<string, string>> = {};
    for (const unit of ["kilometer", "celsius", "kilometer-per-hour"]) {
      out[unit] = {};
      for (const loc of LOCALES)
        out[unit][loc] = new Intl.NumberFormat(loc, { style: "unit", unit, unitDisplay: "long" }).format(5);
    }
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// DateTimeFormat — default raw; timeZoneName (zone/<loc>.res) compressed
// ---------------------------------------------------------------------------

describe("Intl.DateTimeFormat", () => {
  snapshotIf("default", () => {
    const out: Record<string, string> = {};
    for (const loc of LOCALES) out[loc] = new Intl.DateTimeFormat(loc, { timeZone: "UTC" }).format(0);
    expect(out).toMatchSnapshot();
  });

  snapshotIf("timeZoneName:'long' (zone/<loc>.res)", () => {
    const tzName = (loc: string, tz: string) =>
      new Intl.DateTimeFormat(loc, { timeZone: tz, timeZoneName: "long" })
        .formatToParts(0)
        .find(p => p.type === "timeZoneName")!.value;
    const out: Record<string, Record<string, string>> = {};
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "Europe/Berlin"]) {
      out[tz] = {};
      for (const loc of LOCALES) out[tz][loc] = tzName(loc, tz);
    }
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Collator — coll/* raw (incl. CJK tailorings)
// ---------------------------------------------------------------------------

describe("Intl.Collator", () => {
  // The default locale must not be ICU's en_US_POSIX fallback (what an invalid
  // platform language tag degrades to; bionic's default "C.UTF-8" used to
  // produce exactly that): its case-first collation gives "a".localeCompare("B") === 1.
  test("default locale is a real locale, not en-US-u-va-posix", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify([new Intl.Collator().resolvedOptions().locale, "a".localeCompare("B")]))`,
      ],
      // whatever the environment says, including nothing at all
      env: { ...bunEnv, LANG: undefined, LC_ALL: undefined, LC_CTYPE: undefined },
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const [locale, order] = JSON.parse(stdout);
    expect(locale).not.toContain("posix");
    expect(order).toBe(-1);
    expect(exitCode).toBe(0);
  });

  // Same path with the C locale spelled "C.UTF-8" (glibc/musl name for it, and
  // what bionic reports by default): WTF must still treat it as C -> "en-US".
  test.skipIf(!isLinux)("default locale under C.UTF-8 is not en-US-u-va-posix", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { dlopen } = require("bun:ffi");
         const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, { setlocale: { args: ["i32", "cstring"], returns: "cstring" } });
         const LC_CTYPE = 0; // glibc, musl and bionic; the category platformLanguage() reads
         const set = String(libc.symbols.setlocale(LC_CTYPE, Buffer.from("C.UTF-8\\0")));
         console.log(JSON.stringify([set, new Intl.Collator().resolvedOptions().locale, "a".localeCompare("B"), (12345.5).toLocaleString()]));`,
      ],
      env: bunEnv,
      stdout: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const [set, locale, order, grouped] = JSON.parse(stdout);
    // a libc without a C.UTF-8 locale keeps "C", which is the case above
    if (set === "C.UTF-8") {
      expect(locale).toBe("en-US");
      expect(order).toBe(-1);
      expect(grouped).toBe("12,345.5");
    }
    expect(exitCode).toBe(0);
  });

  snapshotIf("sort order across locales", () => {
    const out: Record<string, string[]> = {};
    for (const loc of LOCALES) out[loc] = ["z", "a", "ä", "ö", "Z", "A"].sort(new Intl.Collator(loc).compare);
    expect(out).toMatchSnapshot();
  });

  snapshotIf("zh pinyin (coll/zh.res, 713 KB raw)", () => {
    expect(["波", "次", "阿"].sort(new Intl.Collator("zh", { collation: "pinyin" }).compare)).toMatchSnapshot();
  });

  snapshotIf("ko", () => {
    expect(["하", "가", "나"].sort(new Intl.Collator("ko").compare)).toMatchSnapshot();
  });

  snapshotIf("de phonebook vs standard", () => {
    expect({
      standard: ["öf", "of"].sort(new Intl.Collator("de").compare),
      phonebook: ["öf", "of"].sort(new Intl.Collator("de-u-co-phonebk").compare),
    }).toMatchSnapshot();
  });

  test("sensitivity:'base' equates case and diacritics", () => {
    const c = new Intl.Collator("en", { sensitivity: "base" });
    expect(c.compare("a", "A")).toBe(0);
    expect(c.compare("a", "á")).toBe(0);
    expect(c.compare("a", "b")).toBeLessThan(0);
  });

  // A Latin-1 string of 2^30 or more characters cannot be upconverted to UTF-16:
  // the Vector<char16_t> behind it is past its maximum capacity. When the other
  // operand is 16-bit, none of the 8-bit fast paths apply and ICU needs the
  // UTF-16 form. A NUL operand does the same with two 8-bit strings: NUL has no
  // UCA DUCET weight, so the ASCII fast path gives up and the fallback runs.
  // JSC used to CRASH() there instead of throwing.
  test("comparing a huge Latin-1 string through the ICU fallback throws instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const huge = "a".repeat(2 ** 30);
         const out = [];
         for (const compare of [
           () => huge.localeCompare("\\u3042"),
           () => "\\u3042".localeCompare(huge),
           () => new Intl.Collator().compare(huge, "\\u3042"),
           () => new Intl.Collator("en", { sensitivity: "base" }).compare("\\u3042", huge),
           () => new Intl.Collator("en").compare(huge, "\\0"),
           () => new Intl.Collator("en").compare("\\0", huge),
         ]) {
           try {
             out.push(compare());
           } catch (e) {
             out.push(String(e));
           }
         }
         console.log(JSON.stringify(out));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(Array(6).fill("RangeError: Out of memory"));
    expect(exitCode).toBe(0);
  });
});

// ICU reads its own default locale from LC_ALL, then LC_MESSAGES, then LANG the
// first time a calendar or collator is opened. A value it cannot parse used to
// leave that default unset, and the first Date#toString / localeCompare / Intl
// constructor then crashed inside ICU. Bun's own default locale does not come
// from these variables, so every value, parseable or not, must give the en-US
// output. On Windows neither holds: ICU reads the system locale and JSC reports
// the UI language of the machine.
describe.skipIf(isWindows).concurrent("locale variables in the environment", () => {
  const script = `console.log(JSON.stringify([
    new Date(0).toString(),
    "a".localeCompare("b"),
    (1234.5).toLocaleString(),
    new Intl.DateTimeFormat().resolvedOptions().locale,
  ]))`;

  test.each([
    // eleven bytes is the longest language subtag ICU accepts
    { LANG: "abcdefghijkl" },
    { LANG: "/usr/lib/locale/en_US" },
    // ICU turns the modifier into a variant before it parses the value, and a
    // variant of 180 or more bytes is rejected. The value itself canonicalizes.
    { LANG: "en_US@k=" + Buffer.alloc(200, "a").toString() },
    { LC_MESSAGES: "abcdefghijkl" },
    { LC_ALL: "abcdefghijkl", LANG: "en_US.UTF-8" },
    // a parseable or empty variable in front of an unparseable one wins
    { LC_ALL: "C", LANG: "abcdefghijkl" },
    { LC_ALL: "", LANG: "abcdefghijkl" },
    { LC_ALL: "de_DE.UTF-8" },
  ])("%o", async vars => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, ...vars },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)",
      -1,
      "1,234.5",
      "en-US",
    ]);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Segmenter — brkitr/* raw (incl. cjdict)
// ---------------------------------------------------------------------------

describe("Intl.Segmenter", () => {
  const seg = (loc: string, g: Intl.SegmenterOptions["granularity"], s: string) =>
    [...new Intl.Segmenter(loc, { granularity: g }).segment(s)].map(x => x.segment);

  snapshotIf("grapheme — emoji ZWJ sequence", () => {
    expect(seg("en", "grapheme", "👨‍👩‍👧‍👦a🇯🇵")).toMatchSnapshot();
  });

  snapshotIf("word — en/zh/ja/th", () => {
    expect({
      en: seg("en", "word", "hello world"),
      zh: seg("zh", "word", "中文分词测试"),
      ja: seg("ja", "word", "今日はいい天気"),
      th: seg("th", "word", "สวัสดีครับ"),
    }).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// PluralRules / ListFormat / RelativeTimeFormat — supplemental, raw
// ---------------------------------------------------------------------------

describe("Intl.PluralRules", () => {
  snapshotIf("select across locales", () => {
    const out: Record<string, Record<number, string>> = {};
    for (const loc of ["en", "ru", "ar", "pl"]) {
      out[loc] = {};
      for (const n of [0, 1, 2, 3, 5, 11, 21]) out[loc][n] = new Intl.PluralRules(loc).select(n);
    }
    expect(out).toMatchSnapshot();
  });
});

describe("Intl.ListFormat", () => {
  snapshotIf("conjunction across locales", () => {
    const out: Record<string, string> = {};
    for (const loc of LOCALES) out[loc] = new Intl.ListFormat(loc, { type: "conjunction" }).format(["a", "b", "c"]);
    expect(out).toMatchSnapshot();
  });
});

describe("Intl.RelativeTimeFormat", () => {
  snapshotIf("format across locales", () => {
    const out: Record<string, string[]> = {};
    for (const loc of LOCALES) {
      const f = new Intl.RelativeTimeFormat(loc);
      out[loc] = [f.format(-1, "day"), f.format(2, "day"), f.format(-3, "month")];
    }
    expect(out).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// String / URL paths through ICU — raw
// ---------------------------------------------------------------------------

describe("String.prototype.normalize", () => {
  test("NFC/NFD round-trip", () => {
    const nfd = "café";
    expect(nfd.normalize("NFC")).toBe("café");
    expect("café".normalize("NFD")).toBe(nfd);
    expect(nfd.normalize("NFC").normalize("NFD")).toBe(nfd);
  });
});

describe("String.prototype.toLocale*Case", () => {
  test("tr dotted/dotless i", () => {
    expect("I".toLocaleLowerCase("tr")).toBe("ı");
    expect("i".toLocaleUpperCase("tr")).toBe("İ");
  });
});

describe("URL IDNA", () => {
  test("non-ASCII hostname → punycode", () => {
    expect(new URL("https://例え.jp").hostname).toBe("xn--r8jz45g.jp");
    expect(new URL("https://bücher.de").hostname).toBe("xn--bcher-kva.de");
  });
});

describe("Intl.getCanonicalLocales", () => {
  test("deprecated BCP-47 tags map to modern equivalents", () => {
    // ICU ships .res bundles under the deprecated tag names; canonicalization
    // is what makes them reachable.
    expect({
      in: Intl.getCanonicalLocales("in")[0],
      iw: Intl.getCanonicalLocales("iw")[0],
      mo: Intl.getCanonicalLocales("mo")[0],
      ji: Intl.getCanonicalLocales("ji")[0],
    }).toEqual({ in: "id", iw: "he", mo: "ro", ji: "yi" });
    // sh/tl/no are kept as-is (ICU ships bundles under both names)
    expect(Intl.getCanonicalLocales(["sh", "tl", "no"])).toEqual(["sh", "tl", "no"]);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive sweep — load EVERY compressed item.
//
// icu-locales.txt is the full set of locales present in ICU's display-name
// trees (extracted from the package at build time). Iterating each × the five
// tree-touching APIs forces every region/ lang/ curr/ unit/ zone/ item through
// the decompress hook. A corrupt item surfaces as a throw or empty string;
// "everything fell back to root" surfaces as low distinct-value count.
//
// Regenerate the fixture when WEBKIT_VERSION bumps ICU:
//   icupkg -l icudt<NN>l.dat | grep -E '^(curr|lang|region|unit|zone)/' \
//     | sed -E 's|.*/||; s|\.res$||; s|_|-|g' | sort -u > icu-locales.txt
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

describe("exhaustive locale sweep (every compressed item)", () => {
  const all = readFileSync(new URL("./icu-locales.txt", import.meta.url), "utf8")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
    // ICU's tree includes legacy/alias tags (e.g. no_NO_NY) that aren't valid
    // BCP-47; getCanonicalLocales throws on those, so drop them up front.
    .filter(tag => {
      try {
        Intl.getCanonicalLocales(tag);
        return true;
      } catch {
        return false;
      }
    });

  const locales = Intl.DisplayNames.supportedLocalesOf(all);

  type Tree = "region" | "lang" | "curr" | "unit" | "zone";
  const probe: Record<Tree, (loc: string) => string | undefined> = {
    region: loc => new Intl.DisplayNames(loc, { type: "region" }).of("US"),
    lang: loc => new Intl.DisplayNames(loc, { type: "language" }).of("en"),
    curr: loc => new Intl.DisplayNames(loc, { type: "currency" }).of("USD"),
    unit: loc => new Intl.NumberFormat(loc, { style: "unit", unit: "meter", unitDisplay: "long" }).format(1),
    zone: loc =>
      new Intl.DateTimeFormat(loc, { timeZone: "America/Los_Angeles", timeZoneName: "long" })
        .formatToParts(0)
        .find(p => p.type === "timeZoneName")?.value,
  };

  for (const tree of Object.keys(probe) as Tree[]) {
    test(`${tree}/ — ${locales.length} locales, non-empty + locale-varying`, () => {
      const seen = new Set<string>();
      for (const loc of locales) {
        const v = probe[tree](loc);
        expect(typeof v).toBe("string");
        expect(v!.length).toBeGreaterThan(0);
        seen.add(v!);
      }
      // Regional variants (en-GB, ar-AE, …) legitimately share strings with
      // their base locale, so the bar is "many distinct", not "all distinct".
      expect(seen.size).toBeGreaterThan(50);
    });
  }

  test("repeat calls return identical results (cache consistency)", () => {
    for (const loc of ["ko", "ru", "zh-Hant", "yo", "ar-EG"]) {
      const a = new Intl.DisplayNames(loc, { type: "region" }).of("US");
      const b = new Intl.DisplayNames(loc, { type: "region" }).of("US");
      expect(a).toBe(b);
    }
  });
});
