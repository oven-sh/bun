import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/run-programs";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signalCode: child.signalCode };
}

const show = `
  function show(label: string, run: () => unknown): void {
    try {
      console.log(label, JSON.stringify(run()));
    } catch (error) {
      console.log(label, String(error));
    }
  }
  const at = new Date(1721000000000);
`;

const files = {
  "hello.ts": `console.log("hello world");`,
  "names-none.ts": `
    import { domainToASCII, domainToUnicode } from "node:url";
    ${show}
    show("date", () => [at.toString(), new Date(2024, 0, 15, 12, 30).toString(), at.toTimeString(), String(at), at.getHours(), at.getTimezoneOffset()]);
    show("parse", () => [Date.parse("2024-03-10T02:30:00"), Date.parse("Mar 10, 2024 10:00"), new Date(1900, 0, 1).getTime()]);
    show("json", () => [JSON.stringify(at), at.toISOString(), Bun.inspect(at)]);
    console.log(at, [at]);
    show("url", () => [new URL("http://bücher.example/ä?ö#ü").href, new URL("http://xn--bcher-kva.example").hostname, new URL("https://☃.net").host]);
    show("domain", () => [domainToASCII("español.com"), domainToUnicode("xn--espaol-zwa.com"), domainToASCII("xn--iñvalid.com")]);
    show("normalize", () => ["é".normalize().length, "é".normalize("NFD").length, "ﬁ①".normalize("NFKC"), "ﬁ①Å".normalize("NFKD").length]);
    show("case", () => ["straße".toUpperCase(), "İI".toLowerCase(), "ΑΣ".toLowerCase(), "ıi".toLocaleUpperCase("tr")]);
    show("number", () => [String(1.5), (1234.5678).toFixed(2), (255).toString(16)]);
    show("width", () => [Bun.stringWidth("👩‍👩‍👧"), Bun.stringWidth("漢字"), Bun.stringWidth("e\\u0301")]);
    show("regexp", () => ["Ünï çødé 漢字".match(/\\p{L}+/gu), /\\p{Emoji_Presentation}/u.test("😀"), /^\\p{Script=Han}+$/u.test("漢字")]);
    for (const zone of ["Asia/Tokyo", "Europe/London", "Etc/GMT+5", "Antarctica/Troll", "UTC", "Nowhere/Nothing"]) {
      process.env.TZ = zone;
      show(zone, () => [new Date(1721000000000).toString(), new Date(2024, 0, 15).getTimezoneOffset()]);
    }
  `,
  "names-localeCompare.ts": `
    ${show}
    show("default", () => ["b".localeCompare("a"), "ä".localeCompare("z"), "a".localeCompare("á", undefined, { sensitivity: "base" })]);
    show("languages", () => ["ä".localeCompare("z", "de"), "ä".localeCompare("z", "sv"), "ch".localeCompare("d", "cs")]);
    show("sorted", () => ["z", "ä", "a", "Z", "10", "9"].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    show("chinese", () => [["中", "文", "字"].sort((a, b) => a.localeCompare(b, "zh-u-co-pinyin")), ["中", "文", "字"].sort((a, b) => a.localeCompare(b, "zh-u-co-stroke"))]);
    show("refused", () => "a".localeCompare("b", "not a locale"));
  `,
  "names-toLocaleDateString.ts": `
    ${show}
    show("default", () => [at.toLocaleDateString(), at.toLocaleTimeString()]);
    for (const locale of ["en-US", "de", "ja", "ar-EG", "hi", "th", "he", "ru", "xx"]) {
      show(locale, () => [at.toLocaleDateString(locale, { timeZone: "UTC", dateStyle: "full" }), at.toLocaleTimeString(locale, { timeZone: "UTC", timeStyle: "full" })]);
    }
    show("zones", () => [
      at.toLocaleTimeString("de", { timeZone: "Europe/Berlin", timeZoneName: "long" }),
      at.toLocaleTimeString("fr", { timeZone: "America/Argentina/Ushuaia", timeZoneName: "shortGeneric" }),
      at.toLocaleTimeString("es", { timeZone: "Europe/Lisbon", timeZoneName: "longGeneric" }),
    ]);
    show("calendars", () => [
      at.toLocaleDateString("he-u-ca-hebrew", { timeZone: "UTC", dateStyle: "long" }),
      at.toLocaleDateString("zh-u-ca-chinese", { timeZone: "UTC", dateStyle: "long" }),
      at.toLocaleDateString("ja-u-ca-japanese", { timeZone: "UTC", dateStyle: "full" }),
    ]);
    show("day period", () => at.toLocaleTimeString("en", { timeZone: "UTC", hour: "numeric", dayPeriod: "long" }));
  `,
  "names-toLocaleString.ts": `
    ${show}
    show("default", () => [at.toLocaleString(), (1234567.891).toLocaleString(), 12345678901234567890n.toLocaleString()]);
    for (const locale of ["en-IN", "de", "ja", "ar-EG", "hi", "ru", "xx"]) {
      show(locale, () => [
        at.toLocaleString(locale, { timeZone: "UTC", dateStyle: "full", timeStyle: "full" }),
        (-1234567.891).toLocaleString(locale),
        (1234567).toLocaleString(locale, { notation: "compact", compactDisplay: "long" }),
        (1234.5).toLocaleString(locale, { style: "currency", currency: "EUR", currencyDisplay: "name" }),
        (3.5).toLocaleString(locale, { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" }),
      ]);
    }
    show("array", () => [[1234.5, at].toLocaleString("de", { timeZone: "UTC" }), new Float64Array([1234.5]).toLocaleString("fr")]);
  `,
  "names-Intl.ts": `
    ${show}
    show("segments", () => [...new Intl.Segmenter("ja", { granularity: "word" }).segment("今日は良い天気です")].map(part => part.segment));
    show("names", () => [new Intl.DisplayNames("de", { type: "language" }).of("fr"), new Intl.DisplayNames("fr", { type: "region" }).of("US")]);
    show("plural", () => [new Intl.PluralRules("ru").select(3), new Intl.PluralRules("en", { type: "ordinal" }).select(22)]);
    show("relative", () => new Intl.RelativeTimeFormat("es", { numeric: "auto" }).format(-1, "day"));
    show("list", () => new Intl.ListFormat("de", { type: "disjunction" }).format(["a", "b", "c"]));
    show("collator", () => ["10", "9", "1"].sort(new Intl.Collator("sv", { numeric: true }).compare));
    show("number", () => new Intl.NumberFormat("ja", { style: "unit", unit: "kilometer-per-hour" }).format(50));
    show("date", () => new Intl.DateTimeFormat("zh", { dateStyle: "full", timeStyle: "full", timeZone: "Asia/Shanghai" }).format(at));
  `,
  "names-number-toLocaleString.ts": `
    ${show}
    const amount: number = 1234567.891;
    const large: bigint = 12345678901234567890n;
    show("default", () => [amount.toLocaleString(), large.toLocaleString()]);
    for (const locale of ["en-IN", "de", "ja", "ar-EG", "hi", "ru", "xx"]) {
      show(locale, () => [
        amount.toLocaleString(locale),
        large.toLocaleString(locale),
        amount.toLocaleString(locale, { notation: "compact", compactDisplay: "long" }),
        amount.toLocaleString(locale, { style: "currency", currency: "EUR", currencyDisplay: "name" }),
        amount.toLocaleString(locale, { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" }),
      ]);
    }
  `,
  "names-date-toLocaleString.ts": `
    ${show}
    show("default", () => at.toLocaleString());
    for (const locale of ["en-IN", "de", "ja", "ar-EG", "hi", "ru", "he-u-ca-hebrew", "xx"]) {
      show(locale, () => [at.toLocaleString(locale, { timeZone: "UTC", dateStyle: "full", timeStyle: "full" }), at.toLocaleString(locale, { timeZone: "Asia/Kolkata", timeZoneName: "longGeneric" })]);
    }
  `,
  "uses-segmenter.ts": `console.log([...new Intl.Segmenter("en", { granularity: "word" }).segment("two words")].length);`,
  "uses-display_names.ts": `console.log(new Intl.DisplayNames("de", { type: "region" }).of("US"));`,
  "uses-intl.ts": `console.log(new Intl.ListFormat("de").format(["a", "b"]));`,
  "uses-collation.ts": `console.log("b".localeCompare("a"));`,
  "uses-number_formatting.ts": `console.log((1234.5).toLocaleString(process.env.LOCALE ?? "de"));`,
  "uses-date_formatting.ts": `console.log(new Date(0).toLocaleDateString(process.env.LOCALE ?? "de", { timeZone: "UTC" }));`,
  "uses-units.ts": `
    ${show}
    show("unit", () => (3.5).toLocaleString("en", { style: "unit", unit: "liter", unitDisplay: "long" }));
    show("plain", () => (3.5).toLocaleString("de"));
  `,
};

const features = ["segmenter", "display_names", "intl", "collation", "units", "date_formatting", "number_formatting"];
const without = (...kept: string[]) => features.filter(feature => !kept.includes(feature)).join(",");

using probe = tempDir("compile-trim-runtime-icu-data-probe", { "hello.ts": files["hello.ts"] });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

describe.skipIf(!hasIslands || !!unsupported)("--compile --aot --compile-trim-runtime and ICU's data", () => {
  async function build(folder: string, entry: string, outfile: string, leftOut: string | undefined) {
    const trim = leftOut === undefined ? [] : ["--compile-trim-runtime"];
    const built = await run([bunExe(), "build", "--compile", "--aot", ...trim, entry, "--outfile", outfile], folder, {
      ...bunEnv,
      BUN_TRIM_RUNTIME_WITHOUT: leftOut,
    });
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    return statSync(join(folder, outfile + (isWindows ? ".exe" : ""))).size;
  }

  const environments: Record<string, string | undefined>[] = [
    { TZ: undefined },
    { TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" },
    { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
    { TZ: "Etc/GMT+5", LANG: "C" },
  ];

  async function runsAsWhole(entry: string, leftOut: string) {
    using dir = tempDir("compile-trim-runtime-icu-data", files);
    const folder = String(dir);
    await build(folder, entry, "whole", undefined);
    await build(folder, entry, "trimmed", leftOut);
    for (const environment of environments) {
      const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
      const whole = await run([join(folder, "whole")], folder, env);
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await run([join(folder, "trimmed")], folder, env)).toEqual(whole);
    }
  }

  test.skipIf(!isLinux && !isWindows)("most of the data goes with the features that read it", async () => {
    using dir = tempDir("compile-trim-runtime-icu-data", files);
    const folder = String(dir);
    const kept = await build(folder, "names-Intl.ts", "kept", "");
    const leftOut = await build(folder, "names-Intl.ts", "left-out", without());
    expect(kept - leftOut).toBeGreaterThan(8_000_000);
  });

  test.skipIf(!isLinux && !isWindows)(
    "a program that does not name Intl has no rules and dictionaries for breaking text",
    async () => {
      using dir = tempDir("compile-trim-runtime-icu-data", files);
      const folder = String(dir);
      const named = await build(folder, "names-Intl.ts", "named", "");
      const notNamed = await build(folder, "hello.ts", "not-named", "");
      expect(named - notNamed).toBeGreaterThan(2_500_000);
      expect(await run([join(folder, "not-named")], folder)).toMatchObject({
        stdout: "hello world\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test("dates, URLs, normalization and case do not need it", async () => {
    await runsAsWhole("names-none.ts", without());
  });

  test("localeCompare needs only the data of collation", async () => {
    await runsAsWhole("names-localeCompare.ts", without("collation"));
  });

  test("toLocaleDateString and toLocaleTimeString need only the data of date formatting", async () => {
    await runsAsWhole("names-toLocaleDateString.ts", without("date_formatting"));
  });

  test("toLocaleString of a Date needs only the data of date formatting", async () => {
    await runsAsWhole("names-date-toLocaleString.ts", without("date_formatting"));
  });

  test("toLocaleString of a Number or a BigInt needs only the data of number formatting and of units", async () => {
    await runsAsWhole("names-number-toLocaleString.ts", without("number_formatting", "units"));
  });

  test("toLocaleString of anything needs the data of both and of units", async () => {
    await runsAsWhole("names-toLocaleString.ts", without("date_formatting", "number_formatting", "units"));
  });

  test("a program that names Intl keeps all of it", async () => {
    await runsAsWhole("names-Intl.ts", "");
  });

  const leftOutSays = {
    segmenter: "without Intl.Segmenter",
    display_names: "without Intl.DisplayNames",
    intl: "without Intl.ListFormat, Locale, PluralRules, RelativeTimeFormat, getCanonicalLocales and supportedValuesOf",
    collation: "without Intl.Collator and localeCompare",
    date_formatting:
      "without Intl.DateTimeFormat and toLocaleString, toLocaleDateString and toLocaleTimeString of a Date or a Temporal object",
    number_formatting: "without Intl.NumberFormat, Intl.DurationFormat and toLocaleString of a Number or a BigInt",
  };
  for (const [feature, says] of Object.entries(leftOutSays)) {
    test(`${feature}: an executable without it says so`, async () => {
      using dir = tempDir("compile-trim-runtime-icu-data", files);
      const folder = String(dir);
      await build(folder, `uses-${feature}.ts`, "left-out", feature);
      const refused = await run([join(folder, "left-out")], folder);
      expect(refused.stderr).toContain("this executable was built with --compile-trim-runtime, " + says);
      expect(refused).toMatchObject({ stdout: "", exitCode: 70, signalCode: null });
    });
  }

  test.skipIf(!isLinux && !isWindows)(
    "units: an executable without them throws a TypeError where a unit is asked for",
    async () => {
      using dir = tempDir("compile-trim-runtime-icu-data", files);
      const folder = String(dir);
      await build(folder, "uses-units.ts", "left-out", "units");
      expect(await run([join(folder, "left-out")], folder)).toEqual({
        stdout: `unit TypeError: Failed to initialize NumberFormat\nplain "3,5"\n`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});
