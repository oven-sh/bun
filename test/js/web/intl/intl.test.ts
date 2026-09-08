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
    expect([c.compare("a", "A"), c.compare("a", "á"), c.compare("a", "b"), c.compare("b", "a")]).toEqual([0, 0, -1, 1]);
  });

  // The default locale must not be ICU's en_US_POSIX fallback (what an invalid
  // platform language tag degrades to; bionic's default "C.UTF-8" used to
  // produce exactly that): its case-first collation gives "a".localeCompare("B") === 1.
  // Unix WTF maps the C locale to en-US. macOS and Windows report the UI
  // language of the machine, the same one this test process sees.
  // Concurrent: the children here run alongside the "locale variables" children below.
  test.concurrent("default locale is a real locale, not en-US-u-va-posix", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify([new Intl.Collator().resolvedOptions().locale, "a".localeCompare("B")]))`,
      ],
      // whatever the environment says, including nothing at all
      env: { ...bunEnv, LANG: undefined, LC_ALL: undefined, LC_CTYPE: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const locale = isMacOS || isWindows ? new Intl.Collator().resolvedOptions().locale : "en-US";
    expect(stdout).toBe(JSON.stringify([locale, -1]) + "\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Same path with the C locale spelled "C.UTF-8" (glibc/musl name for it, and
  // what bionic reports by default): WTF must still treat it as C -> "en-US".
  test.concurrent.skipIf(!isLinux)("default locale under C.UTF-8 is not en-US-u-va-posix", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { dlopen } = require("bun:ffi");
         const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, { setlocale: { args: ["i32", "cstring"], returns: "cstring" } });
         const LC_CTYPE = 0; // glibc, musl and bionic; the category platformLanguage() reads
         const set = libc.symbols.setlocale(LC_CTYPE, Buffer.from("C.UTF-8\\0"));
         console.log(JSON.stringify([set, new Intl.Collator().resolvedOptions().locale, "a".localeCompare("B"), (12345.5).toLocaleString()]));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // setlocale returns null on a libc without a C.UTF-8 locale. The locale then
    // stays "C", which must give the same en-US output as the test above.
    const out = (set: string | null) => JSON.stringify([set, "en-US", -1, "12,345.5"]) + "\n";
    expect(stdout).toBeOneOf([out("C.UTF-8"), out(null)]);
    expect(stderr).toBe("");
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
    expect(stdout).toBe(
      JSON.stringify(["Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)", -1, "1,234.5", "en-US"]) + "\n",
    );
    expect(stderr).toBe("");
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
// DurationFormat — a "numeric" sub-second unit is the decimal fraction of the
// unit before it. The expectations are built from NumberFormat and ListFormat
// the way ECMA-402 PartitionDurationFormatPattern builds them, so they hold on
// any ICU; the digital and numeric cases have no unit text and use literals.
// ---------------------------------------------------------------------------

describe("Intl.DurationFormat", () => {
  const unit = (value: number, unit: string, unitDisplay: "long" | "short" | "narrow" = "short") =>
    new Intl.NumberFormat("en", {
      style: "unit",
      unit,
      unitDisplay,
      maximumFractionDigits: 9,
      roundingMode: "trunc",
    }).format(value);
  const list = (parts: string[], style: "long" | "short" | "narrow" = "short") =>
    new Intl.ListFormat("en", { type: "unit", style }).format(parts);

  test("fraction of a sub-second unit is shown when the unit that carries it is zero", () => {
    const df = new Intl.DurationFormat("en", { milliseconds: "numeric" });
    expect(df.format({ milliseconds: 250 })).toBe(unit(0.25, "second"));
    expect(df.format({ hours: 3, milliseconds: 250 })).toBe(list([unit(3, "hour"), unit(0.25, "second")]));
    expect(df.format({ microseconds: 500 })).toBe(unit(0.0005, "second"));
    expect(df.format({ nanoseconds: 1 })).toBe(unit(0.000000001, "second"));
    // Unchanged: a non-zero carrier, and a zero duration.
    expect(df.format({ seconds: 1, milliseconds: 500 })).toBe(unit(1.5, "second"));
    expect(df.format({ milliseconds: 0 })).toBe("");
    expect(df.format({ hours: 3 })).toBe(unit(3, "hour"));

    expect(df.formatToParts({ milliseconds: 999 }).map(p => [p.type, p.value])).toEqual(
      new Intl.NumberFormat("en", { style: "unit", unit: "second", unitDisplay: "short", maximumFractionDigits: 9 })
        .formatToParts(0.999)
        .map(p => [p.type, p.value]),
    );

    for (const style of ["long", "short", "narrow"] as const) {
      expect(new Intl.DurationFormat("en", { style, milliseconds: "numeric" }).format({ milliseconds: 250 })).toBe(
        unit(0.25, "second", style),
      );
      expect(
        new Intl.DurationFormat("en", { style, milliseconds: "numeric" }).format({ minutes: 2, microseconds: 300 }),
      ).toBe(list([unit(2, "minute", style), unit(0.0003, "second", style)], style));
    }
    expect(new Intl.DurationFormat("en", { style: "digital", milliseconds: "numeric" }).format({ milliseconds: 250 })).toBe(
      "0:00:00.25",
    );

    const micro = new Intl.DurationFormat("en", { microseconds: "numeric" });
    expect(micro.format({ microseconds: 55 })).toBe(unit(0.055, "millisecond"));
    expect(micro.format({ seconds: 3, microseconds: 55 })).toBe(list([unit(3, "second"), unit(0.055, "millisecond")]));
    const nano = new Intl.DurationFormat("en", { nanoseconds: "numeric" });
    expect(nano.format({ nanoseconds: 7 })).toBe(unit(0.007, "microsecond"));
    expect(nano.format({ hours: 1, nanoseconds: 7 })).toBe(list([unit(1, "hour"), unit(0.007, "microsecond")]));

    // fractionalDigits truncates what is shown; the display test is on the exact value.
    const twoDigits = new Intl.DurationFormat("en", { milliseconds: "numeric", fractionalDigits: 2 });
    expect(twoDigits.format({ milliseconds: 5 })).toBe(
      new Intl.NumberFormat("en", {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        roundingMode: "trunc",
      }).format(0.005),
    );
    expect(twoDigits.format({ seconds: 0 })).toBe("");
  });

  test("a carrier with integer part zero keeps the sign of the fraction", () => {
    expect(new Intl.DurationFormat("en", { milliseconds: "numeric" }).format({ milliseconds: -250 })).toBe(
      unit(-0.25, "second"),
    );
    expect(
      new Intl.DurationFormat("en", { milliseconds: "numeric" }).format({ hours: -3, milliseconds: -250 }),
    ).toBe(list([unit(-3, "hour"), unit(0.25, "second")]));
    expect(new Intl.DurationFormat("en", { microseconds: "numeric" }).format({ microseconds: -55 })).toBe(
      unit(-0.055, "millisecond"),
    );
    expect(new Intl.DurationFormat("en", { seconds: "numeric" }).format({ milliseconds: -250 })).toBe("-0.25");
    expect(new Intl.DurationFormat("en", { seconds: "numeric" }).format({ milliseconds: 250 })).toBe("0.25");
    expect(new Intl.DurationFormat("en", { seconds: "2-digit" }).format({ milliseconds: -250 })).toBe("-00.25");
    expect(new Intl.DurationFormat("en", { style: "digital" }).format({ milliseconds: -250 })).toBe("-0:00:00.25");
    expect(
      new Intl.DurationFormat("en", { seconds: "numeric" })
        .formatToParts({ milliseconds: -250 })
        .map(p => [p.type, p.value, p.unit]),
    ).toEqual([
      ["minusSign", "-", "second"],
      ["integer", "0", "second"],
      ["decimal", ".", "second"],
      ["fraction", "25", "second"],
    ]);
  });

  test('"numeric" on a sub-second unit defaults its display to "auto" and rejects "always"', () => {
    const resolved = new Intl.DurationFormat("en", { milliseconds: "numeric" }).resolvedOptions();
    expect({
      milliseconds: resolved.milliseconds,
      millisecondsDisplay: resolved.millisecondsDisplay,
      microseconds: resolved.microseconds,
      microsecondsDisplay: resolved.microsecondsDisplay,
      nanoseconds: resolved.nanoseconds,
      nanosecondsDisplay: resolved.nanosecondsDisplay,
    }).toEqual({
      milliseconds: "numeric",
      millisecondsDisplay: "auto",
      microseconds: "numeric",
      microsecondsDisplay: "auto",
      nanoseconds: "numeric",
      nanosecondsDisplay: "auto",
    });
    expect(new Intl.DurationFormat("en", { microseconds: "numeric" }).resolvedOptions().microsecondsDisplay).toBe("auto");
    expect(new Intl.DurationFormat("en", { nanoseconds: "numeric" }).resolvedOptions().nanosecondsDisplay).toBe("auto");
    // Numeric seconds are not a fraction of anything and keep "always"; so does a sub-second unit in a text style.
    expect(new Intl.DurationFormat("en", { seconds: "numeric" }).resolvedOptions().secondsDisplay).toBe("always");
    expect(new Intl.DurationFormat("en", { milliseconds: "short" }).resolvedOptions().millisecondsDisplay).toBe("always");

    for (const options of [
      { milliseconds: "numeric", millisecondsDisplay: "always" },
      { microseconds: "numeric", microsecondsDisplay: "always" },
      { nanoseconds: "numeric", nanosecondsDisplay: "always" },
      { milliseconds: "numeric", nanosecondsDisplay: "always" },
      { seconds: "numeric", millisecondsDisplay: "always" },
      { style: "digital", millisecondsDisplay: "always" },
    ] as const) {
      expect(() => new Intl.DurationFormat("en", options)).toThrow(RangeError);
    }
    expect(() => new Intl.DurationFormat("en", { milliseconds: "numeric", millisecondsDisplay: "auto" })).not.toThrow();
    expect(() => new Intl.DurationFormat("en", { milliseconds: "short", millisecondsDisplay: "always" })).not.toThrow();
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
      // One assertion per tree: two expect() calls per locale cost 0.6 s across
      // the five trees on a debug build, and a failure should name every broken
      // locale at once.
      const empty: string[] = [];
      for (const loc of locales) {
        const v = probe[tree](loc);
        if (typeof v !== "string" || v.length === 0) empty.push(loc);
        else seen.add(v);
      }
      expect(empty).toEqual([]);
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
