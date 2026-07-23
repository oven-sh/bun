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
import { bunEnv, bunExe, isLinux } from "harness";

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

// The IANA timezone table and host-zone display-name cache are filled lazily on
// first Date / Intl access rather than inside VM::VM, so the first access can
// race across Workers that each construct their own VM. Exercise that race in a
// fresh process where nothing has warmed the cache yet: every Worker plus the
// main thread must observe the same resolved zone, the same supportedValuesOf
// count, and the same Date.prototype.toString output.
test.concurrent("timezone lazy-init is consistent across concurrent Workers", async () => {
  const script = `
    const probe = () => ({
      zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      count: Intl.supportedValuesOf("timeZone").length,
      date: new Date(0).toString(),
    });
    const body = "postMessage((" + probe.toString() + ")())";
    const url = URL.createObjectURL(new Blob([body]));
    const workers = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
      const w = new Worker(url);
      w.onmessage = e => { resolve(e.data); w.terminate(); };
      w.onerror = reject;
    }));
    const results = [probe(), ...await Promise.all(workers)];
    for (const r of results)
      if (r.zone !== results[0].zone || r.count !== results[0].count || r.date !== results[0].date)
        throw new Error("inconsistent: " + JSON.stringify(r) + " vs " + JSON.stringify(results[0]));
    console.log(JSON.stringify(results[0]));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TZ: "America/New_York" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.zone).toBe("America/New_York");
  expect(result.count).toBeGreaterThan(400);
  expect(result.date).toContain("Eastern Standard Time");
  expect(exitCode).toBe(0);
});
