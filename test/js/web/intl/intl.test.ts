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
import { isLinux, isMacOS } from "harness";

// Snapshots are CLDR-version-specific. Only check them where Bun bundles the
// ICU they were generated against (Linux); macOS uses Apple's libicucore and
// Windows is on a different ICU build, so snapshot diffs there are expected
// and not a regression. The structural sweep below runs everywhere.
const SNAPSHOT_ICU_VERSION = "75.1";
const snapshotIf = isLinux && process.versions.icu === SNAPSHOT_ICU_VERSION ? test : test.skip;

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
// DateTimeFormat timeZone option — legacy IANA primary zones
// https://github.com/oven-sh/bun/issues/30618
//
// `CET`, `CST6CDT`, `EET`, `EST5EDT`, `MET`, `MST7MDT`, `PST8PDT`, `WET` are
// first-class `Zone`s in the IANA `etcetera` file (not backward links). ICU
// reports them as canonical primaries, so Intl.DateTimeFormat must accept
// them — WebKit's `isValidTimeZoneNameFromICUTimeZone` used to drop every
// non-`/` zone except UTC/GMT, which broke these on Linux/Windows (macOS is
// unaffected because it links the system libicucore).
//
// Per test262 `intl402/DateTimeFormat/timezone-case-insensitive.js`, each
// of these identifiers is expected to round-trip to itself through
// `resolvedOptions().timeZone`.
// ---------------------------------------------------------------------------

describe("Intl.DateTimeFormat timeZone option", () => {
  const legacyPrimaryZones = ["CET", "CST6CDT", "EET", "EST5EDT", "MET", "MST7MDT", "PST8PDT", "WET"] as const;

  describe.each(legacyPrimaryZones)("%s", zone => {
    test("is accepted as a valid IANA primary zone", () => {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone });
      expect(fmt.resolvedOptions().timeZone).toBe(zone);
    });
  });

  test("legacy primary zones are case-insensitive and normalize to the canonical casing", () => {
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "cet" }).resolvedOptions().timeZone).toBe("CET");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "Cst6Cdt" }).resolvedOptions().timeZone).toBe("CST6CDT");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "est5edt" }).resolvedOptions().timeZone).toBe("EST5EDT");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "pst8pdt" }).resolvedOptions().timeZone).toBe("PST8PDT");
  });

  // macOS's system libicucore doesn't list these 8 legacy zones as primaries
  // in its canonical-zone table — they're only reachable as accepted inputs,
  // not enumerated outputs. The expansion lives in the bundled ICU on
  // Linux/Windows.
  test.skipIf(isMacOS)("Intl.supportedValuesOf('timeZone') lists the legacy primary zones", () => {
    const supported = new Set(Intl.supportedValuesOf("timeZone"));
    for (const zone of legacyPrimaryZones) {
      expect(supported.has(zone)).toBe(true);
    }
  });

  test("legacy primary zones apply the expected offset + DST", () => {
    // 2024-06-15T12:00Z is in summer, so CET-observing zones are at +02:00,
    // EET-observing zones at +03:00, WET-observing zones at +01:00, and the
    // North American zones are on their respective DSTs.
    const d = new Date("2024-06-15T12:00:00Z");
    const hourOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    const formatIn = (tz: string) => new Intl.DateTimeFormat("en-US", { ...hourOptions, timeZone: tz }).format(d);
    expect(formatIn("CET")).toBe("14:00");
    expect(formatIn("MET")).toBe("14:00");
    expect(formatIn("EET")).toBe("15:00");
    expect(formatIn("WET")).toBe("13:00");
    expect(formatIn("CST6CDT")).toBe("07:00");
    expect(formatIn("EST5EDT")).toBe("08:00");
    expect(formatIn("MST7MDT")).toBe("06:00");
    expect(formatIn("PST8PDT")).toBe("05:00");
  });

  test("Date.prototype.toLocaleString accepts the legacy zones too", () => {
    // toLocaleString funnels through the same time-zone resolution path as
    // Intl.DateTimeFormat, so it should agree on both the accepted-set and
    // the rejected-set.
    const d = new Date("2024-06-15T12:00:00Z");
    const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    for (const zone of legacyPrimaryZones) {
      const viaDTF = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(d);
      const viaDate = d.toLocaleString("en-US", { ...options, timeZone: zone });
      expect(viaDate).toBe(viaDTF);
    }
    expect(() => d.toLocaleString("en-US", { timeZone: "BogusZone" })).toThrow(RangeError);
  });

  test("unknown zones still throw RangeError", () => {
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "Not/A_Zone" })).toThrow(RangeError);
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: "BogusZone" })).toThrow(RangeError);
  });

  test("standard IANA zones continue to work", () => {
    const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    expect(fmt("UTC")).toBe("UTC");
    expect(fmt("GMT")).toBe("GMT");
    expect(fmt("America/New_York")).toBe("America/New_York");
    expect(fmt("Europe/London")).toBe("Europe/London");
    expect(fmt("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(fmt("Etc/GMT+5")).toBe("Etc/GMT+5");
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
    expect(c.compare("a", "A")).toBe(0);
    expect(c.compare("a", "á")).toBe(0);
    expect(c.compare("a", "b")).toBeLessThan(0);
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
