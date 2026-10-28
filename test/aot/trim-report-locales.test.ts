// --trim keeps the data of the locales that the program passes as constants. One that is no constant, or that is left to the system, keeps every language.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, test } from "./supported";

// The text of a program starts in line 2.
async function localesOf(text: string) {
  using dir = tempDir("aot-trim-report-locales", { "main.ts": "// @ts-nocheck\n" + text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: trim: locales: ";
  return stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
}
const notConstant = "all, because the locale isn't a constant";
const leftOut = "all, because a call passes no locale, so the system's applies";

describe.concurrent("locales", () => {
  test.each([
    ["a program that formats nothing", `console.log(1);`, "none"],
    ["toLocaleString of a number", `console.log((1234.5).toLocaleString("de"));`, "de"],
    ["toLocaleString of a BigInt", `console.log(10n.toLocaleString("de-AT"));`, "de-AT"],
    ["toLocaleDateString", `console.log(new Date(0).toLocaleDateString("fr"));`, "fr"],
    [
      "toLocaleTimeString with options",
      `console.log(new Date(0).toLocaleTimeString("ja", { hour: "numeric" }));`,
      "ja",
    ],
    ["localeCompare", `console.log("a".localeCompare("b", "sv"));`, "sv"],
    ["toLocaleUpperCase", `console.log("i".toLocaleUpperCase("tr"));`, "tr"],
    ["new Intl.NumberFormat", `console.log(typeof new Intl.NumberFormat("it"));`, "it"],
    ["a call of Intl.DateTimeFormat", `console.log(typeof Intl.DateTimeFormat("es"));`, "es"],
    ["new Intl.Collator", `console.log(typeof new Intl.Collator("fi"));`, "fi"],
    ["new Intl.PluralRules", `console.log(typeof new Intl.PluralRules("pl"));`, "pl"],
    ["new Intl.ListFormat", `console.log(typeof new Intl.ListFormat("nl"));`, "nl"],
    ["new Intl.RelativeTimeFormat", `console.log(typeof new Intl.RelativeTimeFormat("pt-BR"));`, "pt-BR"],
    ["new Intl.DisplayNames", `console.log(typeof new Intl.DisplayNames("ko", { type: "region" }));`, "ko"],
    ["new Intl.Segmenter", `console.log(typeof new Intl.Segmenter("th"));`, "th"],
    ["a list", `console.log(typeof new Intl.NumberFormat(["de", "en-US"]));`, "de, en-US"],
    ["a tag in another spelling", `console.log((1).toLocaleString("EN-us"));`, "en-US"],
    [
      "several calls",
      `console.log((1).toLocaleString("de"), "a".localeCompare("b", "fr"), (2).toLocaleString("de"));`,
      "de, fr",
    ],
    ["either arm of a choice", `console.log((1).toLocaleString(process.argv[2] ? "de" : "fr"));`, "de, fr"],
    [
      "a constant of the module, read in a function",
      `const locale = "de";\nfunction show(value) {\n  return value.toLocaleString(locale);\n}\nconsole.log(show(1));`,
      "de",
    ],
  ])("%s", async (_, text, locales) => {
    expect(await localesOf(text)).toEqual([locales]);
  });

  test.each([
    [
      "an argument of the program",
      `console.log((1).toLocaleString(process.argv[2]));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:2:32`,
    ],
    [
      "one constant and one that is none",
      `console.log((1).toLocaleString("de"));\nconsole.log((1).toLocaleString(process.argv[2]));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:3:32`,
    ],
    [
      "a variable that is assigned twice",
      `let locale = "de";\nif (process.argv[2]) locale = process.argv[2];\nconsole.log((1).toLocaleString(locale));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:4:17`,
    ],
    [
      "a parameter",
      `function show(value, locale) {\n  return value.toLocaleString(locale);\n}\nconsole.log(show(1, "de"));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:3:16`,
    ],
    [
      "a list that something is pushed into",
      `const locales = ["de"];\nlocales.push(process.argv[2]);\nconsole.log(typeof new Intl.NumberFormat(locales));`,
      `${notConstant} (Intl.NumberFormat) at main.ts:2:17`,
    ],
    [
      "a list with an element that is no constant",
      `console.log(typeof new Intl.NumberFormat(["de", process.argv[2]]));`,
      `${notConstant} (Intl.NumberFormat) at main.ts:2:42`,
    ],
    [
      "an Intl.Locale",
      `console.log((1).toLocaleString(new Intl.Locale("de")));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:2:41`,
    ],
    [
      "a text that is no tag",
      `console.log(Intl.supportedValuesOf("collation").length);`,
      `${notConstant} (Intl.supportedValuesOf) at main.ts:2:36`,
    ],
    [
      "arguments that are spread",
      `console.log((1).toLocaleString(...process.argv.slice(2)));`,
      `${notConstant} (Number.prototype.toLocaleString) at main.ts:2:17`,
    ],
    [
      "a method that another built-in calls",
      `console.log(["b", "a"].sort(String.prototype.localeCompare));`,
      `${notConstant} (String.prototype.localeCompare) at main.ts:2:29`,
    ],
    [
      "code from a string",
      `console.log(new Function(process.argv[2])());`,
      `${notConstant} (Function) at main.ts:2:17`,
    ],
  ])("all with %s", async (_, text, locales) => {
    expect(await localesOf(text)).toEqual([locales]);
  });

  test.each([
    [
      "toLocaleString without arguments",
      `console.log((1234.5).toLocaleString());`,
      `${leftOut} (Number.prototype.toLocaleString) at main.ts:2:22`,
    ],
    [
      "localeCompare without a locale",
      `console.log("a".localeCompare("b"));`,
      `${leftOut} (String.prototype.localeCompare) at main.ts:2:17`,
    ],
    [
      "undefined",
      `console.log(new Date(0).toLocaleDateString(undefined, { year: "numeric" }));`,
      `${leftOut} (Date.prototype.toLocaleDateString) at main.ts:2:44`,
    ],
    [
      "an empty list",
      `console.log(typeof new Intl.NumberFormat([]));`,
      `${leftOut} (Intl.NumberFormat) at main.ts:2:42`,
    ],
    [
      "new Intl.DateTimeFormat()",
      `console.log(typeof new Intl.DateTimeFormat());`,
      `${leftOut} (Intl.DateTimeFormat) at main.ts:2:20`,
    ],
  ])("all with %s", async (_, text, locales) => {
    expect(await localesOf(text)).toEqual([locales]);
  });
});
