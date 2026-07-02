// ECMA-402 Intl coverage. Doubles as the regression net for oven-sh/WebKit's
// per-item zstd repack of ICU common data (icu/compress-data.ts): every non-en
// case in DisplayNames / NumberFormat(unit|currencyDisplay:"name") /
// DateTimeFormat(timeZoneName) reads a zstd-decompressed item at runtime
// (bun_icu_decompress.cpp).
//
// What is NOT compressed is a deliberate, measured, per-item policy — it lives
// in oven-sh/WebKit's icu/keep-raw.txt and this suite mirrors it. Kept raw so
// they can never cost a first-use decompress: the Unicode tries (*.icu, *.nrm
// → JSC init, String.normalize, URL IDNA), each tree's shared pool.res and
// every root-level bundle (root.res, supplementalData, zoneinfo64, … → the
// first Intl call of any kind), the root collation (coll/root.res, ucadata.icu
// → the first localeCompare), the >100 KB CJK collation tailorings (coll/zh,
// ko, ja), the brkitr/*.dict break dictionaries (cjdict alone is 2 MB), en*,
// and every *.brk break RULE. So the CJK Collator cases and every Segmenter
// case below exercise RAW items today, while the small-locale Collator cases
// (de, fr, ru, ar, th, ...) exercise COMPRESSED tailorings. Either way, if
// keep-raw.txt ever changes, the output is already pinned to the
// uncompressed ground truth.
//
// Snapshots are the ground truth: they capture uncompressed-ICU output. If a
// decompressed item is wrong, the snapshot diff shows exactly which locale/tree.
// When WEBKIT_VERSION bumps ICU/CLDR, regenerate with `-u` against a build that
// links the unmodified libicudata.a.

import { describe, expect, test } from "bun:test";
import { isLinux } from "harness";

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
// Collator — small per-locale tailorings are compressed; coll/root.res,
// coll/ucadata.icu (every Collator inherits the root collation → the first
// localeCompare) and the >100 KB zh/ko/ja tailorings are kept raw on purpose
// (see keep-raw.txt). These cases pin the tailored orderings either way.
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

  snapshotIf("zh stroke (a second tailoring in coll/zh.res)", () => {
    expect(["一", "丁", "中", "九"].sort(new Intl.Collator("zh", { collation: "stroke" }).compare)).toMatchSnapshot();
  });

  snapshotIf("ko", () => {
    expect(["하", "가", "나"].sort(new Intl.Collator("ko").compare)).toMatchSnapshot();
  });

  snapshotIf("ja (coll/ja.res)", () => {
    expect(["ば", "は", "ぱ", "バ", "ハ", "ー"].sort(new Intl.Collator("ja").compare)).toMatchSnapshot();
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
// Segmenter — the brkitr/*.dict word dictionaries (cjdict is the single
// largest item in ICU, 2 MB) and the brkitr/*.brk rules are BOTH kept raw on
// purpose (see keep-raw.txt): rules load on every Segmenter, dictionaries on
// the first input containing that script. These cases pin every dictionary's
// segmentation so a future change to either is caught.
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

  snapshotIf("word — km/lo/my (the khmer/lao/burmese dictionaries)", () => {
    // Word-breaking these scripts is what loads brkitr/{khmer,lao,burmese}dict
    // (kept raw today; see keep-raw.txt). cjdict/thaidict are covered above.
    // These snapshots pin each dictionary's output either way.
    expect({
      km: seg("km", "word", "ភាសាខ្មែរគឺជាភាសាផ្លូវការ"),
      lo: seg("lo", "word", "ພາສາລາວເປັນພາສາທາງການ"),
      my: seg("my", "word", "မြန်မာဘာသာစကားဖြစ်သည်"),
    }).toMatchSnapshot();
  });

  snapshotIf("word isWordLike across dictionary scripts", () => {
    const wordLike = (loc: string, s: string) =>
      [...new Intl.Segmenter(loc, { granularity: "word" }).segment(s)].filter(x => x.isWordLike).map(x => x.segment);
    expect({
      zh: wordLike("zh", "中华人民共和国位于亚洲"),
      ja: wordLike("ja", "吾輩は猫である"),
      th: wordLike("th", "ภาษาไทยไม่มีการเว้นวรรค"),
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
// Exhaustive sweep — load EVERY compressed item, and the kept-raw neighbors.
//
// icu-locales.txt is the full set of locales present in ICU's display-name
// trees (extracted from the package at build time). Iterating each × the five
// tree-touching APIs forces every per-locale region/ lang/ curr/ unit/ zone/
// item through the decompress hook (each tree's shared pool.res is kept raw
// per keep-raw.txt but loads on the same path). The coll/ sweep loads every
// collation tailoring: the small per-locale ones are compressed, while
// keep-raw.txt keeps the root collation and the >100 KB zh/ko/ja raw. A
// corrupt item surfaces as a throw or empty string; "everything fell back to
// root" surfaces as a low distinct-value count.
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

  // The coll/ and brkitr/ sweeps below assert that SPECIFIC ICU DATA ITEMS in
  // Bun's bundled archive behave (the collation tailorings and the break
  // dictionaries). That only means anything against the bundled ICU the rest
  // of the snapshots were generated from: macOS uses Apple's system libicucore
  // and Windows bundles a different ICU, both of which are free to ship a
  // different subset (Apple's may omit break dictionaries entirely). So they
  // share the snapshot gate even though they aren't snapshot tests.

  // coll/<loc>.res: load every locale's collation tailoring. No per-locale
  // assertion can catch a corrupt tailoring: a single deterministic Collator
  // is self-consistent even over garbage data, and on a bad bundle ICU falls
  // back to the root collation rather than throwing. The invariant that CAN
  // fail is the aggregate: root fallback makes every locale produce the SAME
  // order, so a meaningful number of them must still DIFFER (sv/da sort å
  // after z, cs has the "ch" digraph, zh/ja/ko tailor CJK, ...). The orders
  // themselves are pinned by the de/zh/ko/ja snapshots above.
  snapshotIf(`coll/ — ${locales.length} locales, valid tailored sort`, () => {
    const probe = ["ch", "c", "h", "i", "å", "ä", "ö", "z", "a", "ñ", "n", "ー", "あ", "ア", "가", "하", "中", "一"];
    const orders = new Set<string>();
    for (const loc of locales) {
      // "|" never appears in a probe element, so distinct orderings cannot
      // collide (the probe holds both "ch" and the separate "c" / "h").
      orders.add(probe.toSorted(new Intl.Collator(loc).compare).join("|"));
    }
    expect(orders.size).toBeGreaterThan(10);
  });

  // brkitr/<lang>.dict: one non-trivial word segmentation per dictionary.
  // Each must produce several multi-character word-like segments — a broken
  // dictionary degrades to per-character breaks, which this catches without
  // being CLDR-version-sensitive.
  snapshotIf("brkitr/ — every break dictionary yields real words", () => {
    const texts: Record<string, string> = {
      zh: "中华人民共和国位于亚洲东部面积约九百六十万平方公里",
      ja: "日本語の形態素解析は辞書を使います吾輩は猫である",
      th: "ภาษาไทยไม่มีการเว้นวรรคระหว่างคำจึงต้องใช้พจนานุกรม",
      km: "ភាសាខ្មែរគឺជាភាសាផ្លូវការរបស់ប្រទេសកម្ពុជា",
      lo: "ພາສາລາວເປັນພາສາທາງການຂອງປະເທດລາວ",
      my: "မြန်မာဘာသာစကားသည်မြန်မာနိုင်ငံ၏ရုံးသုံးဘာသာစကားဖြစ်သည်",
    };
    for (const [loc, text] of Object.entries(texts)) {
      const words = [...new Intl.Segmenter(loc, { granularity: "word" }).segment(text)].filter(s => s.isWordLike);
      expect(words.length).toBeGreaterThan(3);
      expect(Math.max(...words.map(w => w.segment.length))).toBeGreaterThan(1);
    }
  });

  test("repeat calls return identical results (cache consistency)", () => {
    for (const loc of ["ko", "ru", "zh-Hant", "yo", "ar-EG"]) {
      const a = new Intl.DisplayNames(loc, { type: "region" }).of("US");
      const b = new Intl.DisplayNames(loc, { type: "region" }).of("US");
      expect(a).toBe(b);
    }
  });
});
