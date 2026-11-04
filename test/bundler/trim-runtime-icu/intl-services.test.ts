// A method keeps all that it can open of ICU's data. Each program calls one service of Intl in many locales, with every option, and prints a digest of the answers.
// EVERY_LOCALE=1 bun test <this file>: in all eight hundred locales, which takes minutes. What is removed goes by the kind of data, not by the locale.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, getMacOSVersion } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../../aot/harness/compiler";
import { run } from "../../aot/harness/run";
import { inTurn, sharedBuilds } from "../../aot/harness/shared-builds";
import { readRemovedFeatures } from "../../aot/trimmed-against-whole/removed-features";
import { canTrim, model, withoutFeatures } from "../compile-trim-features";

const files = Object.fromEntries(
  readdirSync(import.meta.dir)
    .filter(name => name.endsWith(".js"))
    .map(name => [name, readFileSync(join(import.meta.dir, name), "utf8")]),
);
const features = [
  "IntlSegmenter",
  "IntlDisplayNames",
  "IntlOther",
  "IntlCollation",
  "IntlUnits",
  "IntlDateTimeFormat",
  "IntlNumberFormat",
];

const environments: Record<string, string | undefined>[] = [
  { TZ: "America/Los_Angeles", LANG: "en_US.UTF-8", SOME_LOCALES: process.env.EVERY_LOCALE ? undefined : "1" },
  { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", DEFAULT_LOCALE: "1" },
  { TZ: undefined, LANG: "C", DEFAULT_LOCALE: "1" },
];

const programs: [entry: string, kept: string[]][] = [
  ["date-to-locale-string.js", ["IntlDateTimeFormat"]],
  ["intl-date-time-format.js", ["IntlDateTimeFormat"]],
  ["intl-relative-time-format.js", ["IntlOther", "IntlNumberFormat"]],
  ["number.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-display-names.js", ["IntlDisplayNames"]],
  ["intl-duration-format.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-number-format.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-plural-rules.js", ["IntlOther", "IntlNumberFormat"]],
  ["locale-compare.js", ["IntlCollation"]],
  ["intl-collator.js", ["IntlCollation"]],
  ["intl-list-format.js", ["IntlOther"]],
  ["intl-segmenter.js", ["IntlSegmenter"]],
  ["intl-locale.js", ["IntlOther", "IntlCollation"]],
  ["intl-supported-values-of.js", ["IntlOther", "IntlCollation"]],
  ["intl-get-canonical-locales.js", ["IntlOther"]],
  ["names-none-of-them.js", []],
];

// The ICU of macOS 26.4 cannot format a range of hours with a day period in "ak": there
// `new Intl.DateTimeFormat("ak", { hour: "numeric", dayPeriod: "short" }).formatRange(a, b)` ends any program, compiled or not, inside
// icu::DateIntervalFormat::formatImpl. The ICU of 14.8, 15.7 and 26.6 formats it.
const cannotRunHere = getMacOSVersion()?.startsWith("26.4") ? ["intl-date-time-format.js"] : [];

test("every program is in the table", () => {
  const entries = Object.keys(files).filter(name => name !== "lists.js" && name !== "date.js");
  expect(programs.map(([entry]) => entry).sort()).toEqual(entries.sort());
});

(!canTrim || unsupported ? describe.skip : describe.concurrent)("--compile --aot --trim", () => {
  const { folder, build } = sharedBuilds("trim-runtime-icu", files);

  test.each(programs.filter(([entry]) => !cannotRunHere.includes(entry)))(
    "%s prints what it prints in plain Bun with only %j kept",
    async (entry, kept) => {
      const byUse = await build(entry, "--aot", "--trim");
      const indexes = readRemovedFeatures(byUse.file);
      const removed = model.features.filter(feature => indexes?.includes(feature.index)).map(feature => feature.name);
      expect(removed.filter(feature => kept.includes(feature))).toEqual([]);
      const leftOut = features.filter(feature => !kept.includes(feature));
      const executables = [byUse.executable];
      // Where the build keeps more than the program needs, the rest is forced out.
      if (leftOut.some(feature => !removed.includes(feature)))
        executables.push((await build(entry, "--aot", "--trim", ...withoutFeatures(leftOut))).executable);
      await Promise.all(
        environments.map(async environment => {
          const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
          const [plain, ...others] = await Promise.all(
            [[bunExe(), entry], ...executables.map(executable => [executable])].map(cmd =>
              inTurn(() => run(cmd, folder, env)),
            ),
          );
          expect(plain).toMatchObject({ stderr: "", exitCode: 0 });
          expect(plain.stdout).toMatch(/: \d+ calls, \d+ threw, digest [0-9a-f]+\n$/);
          for (const other of others) expect(other).toEqual(plain);
        }),
      );
    },
    600_000,
  );
});
