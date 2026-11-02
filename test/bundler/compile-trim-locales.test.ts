// `--trim --trim-locales de` keeps the data of German and removes the other languages'. A program that asks for a language that was removed ends with exit code 70.
// The data of en-US is in every executable: it is ICU's default locale where the host's was removed, and the engine's for a locale that it has no data for.
// ICU also opens the data of its own default locale, which it takes from the host: the first date format of a process makes a calendar in it. No program sees that locale
// (Bun's default is en-US on every host), so the language of the host decides nothing: not where it was removed, and not where the host has none (LANG=C is en_US_POSIX to ICU).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/commands";
import { run } from "../aot/harness/run";
import { inTurn } from "../aot/harness/shared-builds";
import { copyWithoutDebugInformation, withoutDebugInformation } from "../aot/harness/without-debug-information";

// Asked of the Bun under test itself, so that a release build, which has no bun:internal-for-testing, runs this file too.
const canTrim = (() => {
  using dir = tempDir("compile-trim-locales-probe", { "probe.ts": "" });
  const probed = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--trim", ...withoutDebugInformation, "probe.ts", "--outfile", "probe"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  return !probed.stderr.toString().includes("this build of Bun doesn't support --trim");
})();

const hosts = [
  "C",
  "C.UTF-8",
  "POSIX",
  "en_US.UTF-8",
  "de_DE.UTF-8",
  "fr_FR.UTF-8",
  "fr_XX.UTF-8",
  "ja_JP.UTF-8",
  "zh_Hant_TW.UTF-8",
  "abcdefghijkl",
  "",
];

const programs = {
  "kept.ts": `
const when = new Date(Date.UTC(2024, 0, 15, 3, 4, 5));
console.log(when.toLocaleDateString("de", { timeZone: "UTC" }));
console.log(when.toLocaleString("de", { timeZone: "UTC", dateStyle: "full", timeStyle: "long" }));
console.log(new Intl.DateTimeFormat("de", { timeZone: "Europe/Berlin", weekday: "long", month: "long", timeZoneName: "long" }).format(when));
console.log(new Intl.NumberFormat("de").format(1234.5), new Intl.PluralRules("de").select(1), ["z", "ä"].sort(new Intl.Collator("de").compare).join());
console.log(new Intl.RelativeTimeFormat("de").format(-1, "day"), new Intl.ListFormat("de").format(["a", "b"]));`,
  // The locale comes with the command line: of a locale that the build can read, --aot makes the pattern itself, and the program asks for no data.
  "removed.ts": `console.log(new Date(0).toLocaleDateString(process.argv[2], { timeZone: "UTC" }));`,
  // These members of Intl.Locale give ICU the locale as it is written, and ICU opens the data of that name.
  // The last date is the first of a process without arguments, for which ICU opens the data of its own locale: the host's where it is kept.
  "opens.ts": `
for (const tag of process.argv.slice(2)) {
  const locale = new Intl.Locale(tag);
  const week = locale.getWeekInfo();
  console.log(tag, locale.getCollations().join(), locale.getHourCycles().join(), locale.getNumberingSystems().join(), locale.getTextInfo().direction, week.firstDay);
  console.log(new Date(0).toLocaleDateString(tag, { timeZone: "UTC", dateStyle: "full" }), new Intl.NumberFormat(tag).format(1234.5), new Intl.PluralRules(tag).select(2));
}
console.log(new Date(0).toLocaleDateString("en", { timeZone: "UTC", dateStyle: "full" }));`,
  "build-opens.ts": `
const built = await Bun.build({
  entrypoints: ["./opens.ts"],
  compile: {
    aot: process.argv[2] === "aot",
    outfile: process.argv[3],
    trim: { locales: process.argv.slice(4) },
    ...(process.env.STARTS_FROM && { executablePath: process.env.STARTS_FROM }),
  },
});
if (!built.success) throw new AggregateError(built.logs);`,
  "constants.ts": `
for (const locale of [new Intl.Locale("ars"), new Intl.Locale("iw")])
  console.log(String(locale), locale.getHourCycles().join(), locale.getNumberingSystems().join(), locale.getTextInfo().direction);
const when = new Date(Date.UTC(2024, 0, 15));
console.log(when.toLocaleDateString("tl", { timeZone: "UTC", dateStyle: "full" }), new Intl.NumberFormat("tl", { style: "currency", currency: "EUR" }).format(1234.5));
console.log(new Intl.DateTimeFormat("ja-JP-u-ca-japanese", { timeZone: "UTC", era: "long", year: "numeric", month: "long", day: "numeric" }).format(when));`,
  // The currencies, the names of regions and of languages, and the units: the data that is removed by locale on every platform.
  "english.ts": `
const when = new Date(Date.UTC(2024, 0, 15));
for (const tag of process.argv.slice(2)) {
  console.log(tag, when.toLocaleDateString(tag, { timeZone: "UTC", dateStyle: "full" }), new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" }).format(1234.5));
  console.log(new Intl.DisplayNames(tag, { type: "region" }).of("FR"), new Intl.DisplayNames(tag, { type: "language" }).of("fr"), new Intl.NumberFormat(tag, { style: "unit", unit: "kilometer", unitDisplay: "long" }).format(3));
}`,
};

// ICU has these languages only as an %%ALIAS of a locale of another one: ar_SA, he, id, ro, sr_Latn, fil, and zh for yue's
// collation. hi_Latn and nb have their %%Parent in en and in no. Data that a bundle needs stays with the bundle.
// A date of yue's Chinese calendar names a numbering system whose rules ICU opens in zh.
const aliases = [
  "ars",
  "ars-SA",
  "iw",
  "in",
  "mo",
  "sh",
  "sh-BA",
  "sh-CS",
  "sh-YU",
  "tl",
  "tl-PH",
  "yue",
  "yue-u-ca-chinese",
  "hi-Latn",
  "nb",
];
// The engine has no data of its own for the first three and formats them as en-US. For the numbers that the calendars of
// the others spell out, ICU opens the currencies of its default locale: en_US where the host's was removed.
const withoutEnglish = ["tl", "ars", "sh", "ja-JP-u-ca-japanese", "he-u-ca-hebrew", "zh-u-ca-chinese"];
const removedMessage = `error: the locale data this program needs was removed by --trim. Add the locale to compile.trim.locales to keep it.${isWindows ? "\r\n" : "\n"}`;

(canTrim ? describe.concurrent : describe.skip)("--trim-locales", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: what is formatted in a locale that was kept does not depend on the locale of the host`,
      async () => {
        using dir = tempDir("compile-trim-locales", programs);
        const folder = String(dir);
        expect(
          await run(
            [
              bunExe(),
              "build",
              "--compile",
              ...flags,
              ...withoutDebugInformation,
              "--trim",
              "--trim-locales=de",
              "kept.ts",
              "--outfile",
              "kept",
            ],
            folder,
          ),
        ).toMatchObject({ exitCode: 0 });
        const expected = await run([bunExe(), "kept.ts"], folder);
        expect(expected).toMatchObject({ stderr: "", exitCode: 0 });
        const answers = await Promise.all(
          hosts.map(async host => ({
            host,
            ...(await run([join(folder, "kept")], folder, { ...bunEnv, LANG: host, LC_ALL: host, LC_MESSAGES: host })),
          })),
        );
        expect(answers).toEqual(hosts.map(host => ({ host, ...expected })));
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: a locale that ICU has as an alias of another language is kept with the data of that language`,
      async () => {
        using dir = tempDir("compile-trim-locales-aliases", programs);
        const folder = String(dir);
        const build = [bunExe(), "build", "--compile", ...flags, ...withoutDebugInformation, "--trim", "opens.ts"];
        const api = [bunExe(), "build-opens.ts", flags.length > 0 ? "aot" : "bundle", join(folder, "api")];
        const builds = [
          // The languages as a program names them, then only the languages that they need: hi keeps en, and en keeps hi.
          [...build, "--trim-locales=ars,iw,in,mo,sh,tl,yue,hi,nb", "--outfile", "named"],
          [...build, "--trim-locales=ar,he,id,ro,sr,fil,zh,en,no", "--outfile", "needed"],
          [...api, "ars", "iw", "in", "mo", "sh", "tl", "yue", "hi", "nb"],
        ];
        const startsFrom = { ...bunEnv, STARTS_FROM: copyWithoutDebugInformation };
        for (const command of builds) expect(await run(command, folder, startsFrom)).toMatchObject({ exitCode: 0 });
        const whole = await run([bunExe(), "opens.ts", ...aliases], folder);
        expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
        for (const name of ["named", "needed", "api"]) {
          expect({ name, ...(await run([join(folder, name), ...aliases], folder)) }).toEqual({ name, ...whole });
        }
        // ICU takes its own locale from the host and opens the data of it. An alias there needs its language too.
        for (const host of ["ars", "ars_SA.UTF-8", "iw_IL.UTF-8", "sh_YU", "tl_PH.UTF-8"]) {
          const env = { ...bunEnv, LANG: host, LC_ALL: host, LC_MESSAGES: host };
          expect({ host, ...(await run([join(folder, "named")], folder, env)) }).toEqual({
            host,
            stdout: "Thursday, January 1, 1970\n",
            stderr: "",
            exitCode: 0,
          });
        }
        // The system's ICU has every language.
        if (isMacOS) return;
        for (const name of ["named", "needed", "api"]) {
          expect({ name, ...(await run([join(folder, name), "de"], folder)) }).toEqual({
            name,
            stdout: "",
            stderr: removedMessage,
            exitCode: 70,
          });
        }
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: a locale that was kept needs no English in the list, whatever the locale of the host`,
      async () => {
        using dir = tempDir("compile-trim-locales-english", programs);
        const folder = String(dir);
        expect(
          await run(
            [
              bunExe(),
              "build",
              "--compile",
              ...flags,
              ...withoutDebugInformation,
              "--trim",
              "--trim-locales=tl,ars,sh,ja,he,zh",
              "english.ts",
              "--outfile",
              "english",
            ],
            folder,
          ),
        ).toMatchObject({ exitCode: 0 });
        const expected = await run([bunExe(), "english.ts", ...withoutEnglish], folder);
        expect(expected).toMatchObject({ stderr: "", exitCode: 0 });
        const answers = await Promise.all(
          hosts.map(async host => ({
            host,
            ...(await run([join(folder, "english"), ...withoutEnglish], folder, {
              ...bunEnv,
              LANG: host,
              LC_ALL: host,
              LC_MESSAGES: host,
            })),
          })),
        );
        expect(answers).toEqual(hosts.map(host => ({ host, ...expected })));
      },
    );

    test.skipIf(isMacOS || (flags.length > 0 && !!unsupported))(
      `${how}: a locale that was removed ends the process, whatever the locale of the host`,
      async () => {
        using dir = tempDir("compile-trim-locales-removed", programs);
        const folder = String(dir);
        expect(
          await run(
            [
              bunExe(),
              "build",
              "--compile",
              ...flags,
              ...withoutDebugInformation,
              "--trim",
              "--trim-locales=de",
              "removed.ts",
              "--outfile",
              "removed",
            ],
            folder,
          ),
        ).toMatchObject({ exitCode: 0 });
        for (const host of ["C", "fr_FR.UTF-8", "de_DE.UTF-8"]) {
          expect({
            host,
            ...(await run([join(folder, "removed"), "fr"], folder, { ...bunEnv, LANG: host, LC_ALL: host })),
          }).toEqual({
            host,
            stdout: "",
            // It is printed through C's stderr.
            stderr: removedMessage,
            exitCode: 70,
          });
        }
      },
    );
  }

  test.skipIf(!!unsupported)(
    "--compile --aot --trim: a locale that the build finds in the program is kept with the data that ICU opens for it",
    async () => {
      using dir = tempDir("compile-trim-locales-found", programs);
      const folder = String(dir);
      const build = ["build", "--compile", "--aot", ...withoutDebugInformation, "--trim", "--explain=trim"];
      const built = await run([bunExe(), ...build, "constants.ts", "--outfile", "found"], folder);
      // The build reads iw as he, and Intl.Locale opens the data of iw. No locale here has the data of en, which tl is formatted with.
      expect({
        locales: built.stderr.split(/\r?\n/).filter(line => line.startsWith("aot: trim: locales:")),
        exitCode: built.exitCode,
      }).toEqual({ locales: ["aot: trim: locales: ars, he, ja-JP-u-ca-japanese, tl"], exitCode: 0 });
      const whole = await run([bunExe(), "constants.ts"], folder);
      expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await run([join(folder, "found")], folder)).toEqual(whole);
    },
  );
});

describe.concurrent("--trim-locales without --trim", () => {
  const files = {
    "month.ts": `console.log(new Date(0).toLocaleDateString(process.argv[2], { timeZone: "UTC", month: "long" }));`,
    "build.ts": `
const built = await Bun.build({
  entrypoints: ["./month.ts"],
  compile: {
    aot: process.argv[2] === "aot",
    outfile: process.argv[3],
    trim: { locales: ["de"] },
    ...(process.env.STARTS_FROM && { executablePath: process.env.STARTS_FROM }),
  },
});
if (!built.success) throw new AggregateError(built.logs);`,
  };

  for (const aot of [false, true]) {
    const build = ["build", "--compile", ...(aot ? ["--aot"] : []), ...withoutDebugInformation];
    const compile = ["compile", ...(aot ? [] : ["--no-aot"]), ...withoutDebugInformation];
    const ways = [
      [...build, "month.ts", "--trim", "--trim-locales=de", "--outfile"],
      [...build, "month.ts", "--trim-locales=de", "--outfile"],
      [...compile, "month.ts", "--trim", "--trim-locales=de", "--outfile"],
      [...compile, "month.ts", "--trim-locales=de", "--outfile"],
      ["build.ts", aot ? "aot" : "bundle"],
    ];

    test.skipIf(!canTrim || (aot && !!unsupported))(
      `${build.slice(0, aot ? 3 : 2).join(" ")}: the executable is the one that --trim --trim-locales and compile.trim.locales build`,
      async () => {
        using dir = tempDir("compile-trim-locales-alone", files);
        const folder = String(dir);
        const buildAndRun = async (way: string[], index: number) => {
          const how = way.join(" ");
          const executable = join(folder, String(index), "month");
          expect({
            how,
            ...(await run([bunExe(), ...way, executable], folder, {
              ...bunEnv,
              STARTS_FROM: copyWithoutDebugInformation,
            })),
          }).toMatchObject({ how, exitCode: 0 });
          const months = await Promise.all(
            ["de", "de-AT", "en", "en-US", "fr", "ja"].map(async tag => {
              const { stdout, exitCode } = await run([executable, tag], folder);
              return [tag, exitCode === 0 ? stdout.trim() : exitCode];
            }),
          );
          const { size } = statSync(isWindows ? executable + ".exe" : executable);
          return { how, size, months: Object.fromEntries(months) };
        };
        const executables = await Promise.all(ways.map((way, index) => inTurn(() => buildAndRun(way, index))));
        const removed = { fr: 70, ja: 70 };
        const fromTheSystemsIcu = { fr: "janvier", ja: "1月" };
        // en is not in the list, and en-US is never removed.
        const kept = { de: "Januar", "de-AT": "Jänner", en: "January", "en-US": "January" };
        const months = { ...kept, ...(isMacOS ? fromTheSystemsIcu : removed) };
        expect(executables).toEqual(ways.map(way => ({ how: way.join(" "), size: executables[0].size, months })));
      },
    );

    test.skipIf(canTrim || (aot && !!unsupported))(
      `${build.slice(0, aot ? 3 : 2).join(" ")}: a Bun that doesn't support --trim says so`,
      async () => {
        using dir = tempDir("compile-trim-locales-alone-unsupported", files);
        const folder = String(dir);
        for (const way of ways) {
          const how = way.join(" ");
          const { stderr, exitCode } = await run([bunExe(), ...way, join(folder, "month")], folder);
          expect({ how, stderr, exitCode }).toEqual({
            how,
            stderr: expect.stringContaining("this build of Bun doesn't support --trim"),
            exitCode: 1,
          });
        }
      },
    );
  }
});
