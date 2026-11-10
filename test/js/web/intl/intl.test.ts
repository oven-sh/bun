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
const SNAPSHOT_ICU_VERSION = "79.1";
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
// Locale#getTextInfo — the direction of the script (ECMA-402 TextDirectionOfLocale).
// No locale bundle is read: a tag with a bundle (ar) and one without (dv, und-Arab)
// answer by the same rule, and the host's locale has no say.
// ---------------------------------------------------------------------------

// The ICU is in the name: macOS has the one of the system, and its data differs by version.
describe(`Intl.Locale.prototype.getTextInfo (ICU ${process.versions.icu})`, () => {
  type Direction = "rtl" | "ltr" | undefined;
  const direction = (tag: string | Intl.Locale, options?: Intl.LocaleOptions): Direction =>
    new Intl.Locale(tag, options).getTextInfo().direction;
  const directions = (tags: string[]) => Object.fromEntries(tags.map(tag => [tag, direction(tag)]));
  const every = (tags: string[], expected: Direction) => Object.fromEntries(tags.map(tag => [tag, expected]));
  const list = (tags: string) => tags.split(" ");

  test("the script of the tag decides, whatever the language is", () => {
    const rtl = ["und-Arab", "und-Hebr", "und-Thaa", "und-Syrc", "und-Nkoo", "und-Adlm"];
    expect(directions(rtl)).toEqual(every(rtl, "rtl"));
    const rtlWithLanguage = ["en-Arab", "abcde-Arab", "ku-Arab", "az-Arab", "ms-Arab", "ha-Arab", "tr-Arab", "pa-Arab"];
    expect(directions(rtlWithLanguage)).toEqual(every(rtlWithLanguage, "rtl"));
    const ltr = ["und-Latn", "ar-Latn", "he-Latn", "sd-Deva", "und-Cyrl", "und-Hans", "und-Jpan", "mn-Mong"];
    expect(directions(ltr)).toEqual(every(ltr, "ltr"));
  });

  // ISO 15924 has codes for one style of a script: Aran is Arabic in the Nastaliq
  // style. CLDR has no direction for them. The ICU of macOS gives Urdu the script Aran.
  test("a code for one style of a script has the direction of the script", () => {
    const rtl = ["ur-Aran", "ks-Aran", "und-Aran", "syr-Syre", "und-Syrj", "und-Syrn"];
    expect(directions(rtl)).toEqual(every(rtl, "rtl"));
    const ltr = ["de-Latf", "und-Latf", "ga-Latg", "und-Latg", "cu-Cyrs", "und-Cyrs"];
    expect(directions(ltr)).toEqual(every(ltr, "ltr"));
  });

  // The likely script of a language or a region comes from the ICU in use. These
  // tags have the same one in every CLDR since 36 and in the ICU of macOS 13 and later.
  test("a tag without a script takes its likely script", () => {
    const rtl = list("dv dv-MV arc glk bal bgn prd sdh rhg ar he fa ur ks ps ckb yi");
    expect(directions(rtl)).toEqual(every(rtl, "rtl"));
    const ltr = ["en", "ja", "zh", "ru", "sv", "hi", "el", "la", "ku", "az", "pa", "und"];
    expect(directions(ltr)).toEqual(every(ltr, "ltr"));
  });

  test("a region is enough where it changes the likely script", () => {
    const rtl = ["und-MV", "und-IL", "und-IR", "und-PK", "und-AF", "und-EG", "az-IR", "az-IQ", "ha-SD", "pa-PK"];
    expect(directions(rtl)).toEqual(every(rtl, "rtl"));
    const ltr = ["und-US", "en-US", "ku-TR", "az-AZ", "pa-IN", "en-IL"];
    expect(directions(ltr)).toEqual(every(ltr, "ltr"));
  });

  // ku-IQ is Arabic since CLDR 48, and sd-IN is Devanagari since CLDR 41.
  snapshotIf("a region whose likely script is new in CLDR", () => {
    expect(directions(["ku-IQ", "sd-IN"])).toEqual({ "ku-IQ": "rtl", "sd-IN": "ltr" });
  });

  test("a tag without a script has the direction of the script that maximize() adds", () => {
    const tags = list("dv und-MV und-IL und-PK ku-IQ sd-IN az-IR pa-PK ur gml mga ar en sv xx");
    const viaLikelyScript = Object.fromEntries(
      tags.map(tag => {
        const script = new Intl.Locale(tag).maximize().script;
        return [tag, script === undefined ? undefined : direction(`und-${script}`)];
      }),
    );
    expect(directions(tags)).toEqual(viaLikelyScript);
    expect(new Set(Object.values(viaLikelyScript))).toEqual(new Set(["rtl", "ltr", undefined]));
  });

  // Variants and private use subtags are not part of the lookup, however many there are.
  test("only the language and the region reach Add Likely Subtags", () => {
    const variants = Array.from({ length: 19 }, (_, index) => `v${1000000 + index}`).join("-");
    const privateUse = Array.from({ length: 24 }, (_, index) => `p${1000000 + index}`).join("-");
    expect({
      "dv with variants": direction(`dv-${variants}`),
      "az-IR with variants": direction(`az-IR-${variants}`),
      "und-MV with variants": direction(`und-MV-${variants}`),
      "und-Arab with variants": direction(`und-Arab-${variants}`),
      "dv with private use": direction(`dv-x-${privateUse}`),
      "sv with variants": direction(`sv-${variants}`),
      "sv with private use": direction(`sv-x-${privateUse}`),
      "xx with variants": direction(`xx-${variants}`),
    }).toEqual({
      "dv with variants": "rtl",
      "az-IR with variants": "rtl",
      "und-MV with variants": "rtl",
      "und-Arab with variants": "rtl",
      "dv with private use": "rtl",
      "sv with variants": "ltr",
      "sv with private use": "ltr",
      "xx with variants": undefined,
    });
  });

  test("variants, keywords and constructor options", () => {
    const rtl = ["und-Arab-u-nu-latn", "en-Arab-u-ca-gregory-hc-h23", "ar-Arab-EG-fonipa", "sl-Arab-rozaj-biske-1994"];
    expect(directions(rtl)).toEqual(every(rtl, "rtl"));
    const ltr = ["ar-Latn-u-nu-arab", "und-Latn-u-ca-hebrew", "de-Latn-1996-u-co-phonebk"];
    expect(directions(ltr)).toEqual(every(ltr, "ltr"));
    expect({
      script: direction("en", { script: "Arab" }),
      scriptOverLanguage: direction("ar", { script: "Latn" }),
      fromLocale: direction(new Intl.Locale("und-Hebr")),
      maximized: new Intl.Locale("und-Arab").maximize().getTextInfo().direction,
      minimized: new Intl.Locale("und-Arab").minimize().getTextInfo().direction,
    }).toEqual({ script: "rtl", scriptOverLanguage: "ltr", fromLocale: "rtl", maximized: "rtl", minimized: "rtl" });
  });

  test("a direction that is not known is undefined, under an own key", () => {
    const unknown = list("xx tlh abcdefgh und-Zzzz en-Zzzz ar-Zyyy und-Zinh und-Brai und-Aaaa und-Qaaq");
    expect(directions(unknown)).toEqual(every(unknown, undefined));
    for (const tag of ["xx", "en-Zzzz", "en", "und-Arab"]) {
      const locale = new Intl.Locale(tag);
      const info = locale.getTextInfo();
      expect(Object.getPrototypeOf(info)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptors(info)).toEqual({
        direction: { value: direction(tag), writable: true, enumerable: true, configurable: true },
      });
      expect(locale.getTextInfo()).not.toBe(info);
    }
  });

  // tc39/test262#5023, test/intl402/Locale/prototype/getTextInfo. The names are the files.
  describe("test262", () => {
    const languages = ["und", "en", "ar", "tlh", "qfz"];
    const withScripts = (scripts: string[]) =>
      languages.flatMap(language => scripts.map(script => `${language}-${script}`));

    test("language-subtag-with-more-than-three-letters.js", () => {
      expect(directions(["abcdefgh", "abcdefgh-Latn", "abcdefgh-Arab", "abcdefgh-Zzzz"])).toEqual({
        "abcdefgh": undefined,
        "abcdefgh-Latn": "ltr",
        "abcdefgh-Arab": "rtl",
        "abcdefgh-Zzzz": undefined,
      });
    });

    test("script-metadata-rtl-is-unknown.js", () => {
      const tags = withScripts(["Zyyy", "Zinh", "Zzzz", "Brai"]);
      expect(directions(tags)).toEqual(every(tags, undefined));
    });

    test("script-metadata-unlisted-language-script-is-rtl.js", () => {
      // The file takes "rtl" or undefined for both, never "ltr".
      expect(directions(["ar-Zxxx", "ur-Aran"])).toEqual({ "ar-Zxxx": undefined, "ur-Aran": "rtl" });
    });

    test("script-subtag-missing.js", () => {
      for (const tag of ["und", "en", "ar", "tlh", "qfz", "pa", "pa-PK"]) {
        const maximized = new Intl.Locale(tag).maximize();
        expect({ tag, direction: direction(tag) }).toEqual({ tag, direction: maximized.getTextInfo().direction });
        if (maximized.script === undefined)
          expect({ tag, direction: direction(tag) }).toEqual({ tag, direction: undefined });
      }
    });

    test("script-subtag-present.js", () => {
      expect(directions(withScripts(["Latn"]))).toEqual(every(withScripts(["Latn"]), "ltr"));
      expect(directions(withScripts(["Arab"]))).toEqual(every(withScripts(["Arab"]), "rtl"));
    });

    test("script-unregistered-or-privateuse.js", () => {
      const tags = withScripts(["Aaaa", "Qaaq", "True"]);
      expect(directions(tags)).toEqual(every(tags, undefined));
    });

    test("output-object-keys.js", () => {
      const info = new Intl.Locale("en").getTextInfo();
      expect(Reflect.ownKeys(info)).toEqual(["direction"]);
      expect(info.direction).toBe("ltr");
    });
  });

  // ICU gives a tag without a bundle the bundle of its own default locale, which
  // it takes from these variables. The direction does not come from a bundle.
  describe.concurrent("the host's locale changes nothing", () => {
    const script = `console.log(["en-Arab", "und-Hebr", "dv", "ar-Latn", "und-Latn", "abcde-Latn", "la", "xx", "en-Zzzz"]
      .map(tag => tag + " " + new Intl.Locale(tag).getTextInfo().direction).join(", "))`;

    test.each([{ LANG: "C" }, { LANG: "ar_EG.UTF-8" }, { LC_ALL: "he_IL.UTF-8" }, { LANG: "en_US.UTF-8" }])(
      "%o",
      async vars => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", script],
          env: { ...bunEnv, LANG: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, ...vars },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout).toBe(
          "en-Arab rtl, und-Hebr rtl, dv rtl, ar-Latn ltr, und-Latn ltr, abcde-Latn ltr, la ltr, xx undefined, en-Zzzz undefined\n",
        );
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      },
    );
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
