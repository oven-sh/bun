// `--trim --trim-locales de` keeps the data of German and removes the other languages'. A program that asks for a language that was removed ends with exit code 70.
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
  // What Intl reads each tag of the command line as, and a number, a plural and a date in it.
  "tags.ts": `
for (const tag of process.argv.slice(2)) {
  console.log(tag, new Intl.NumberFormat(tag).resolvedOptions().locale, new Intl.PluralRules(tag).select(1));
  console.log(new Date(0).toLocaleDateString(tag, { timeZone: "UTC", dateStyle: "full" }));
}`,
  "build-tags.ts": `
const built = await Bun.build({
  entrypoints: ["./tags.ts"],
  compile: {
    aot: process.argv[2] === "aot",
    outfile: process.argv[3],
    trim: { locales: process.argv.slice(4) },
    ...(process.env.STARTS_FROM && { executablePath: process.env.STARTS_FROM }),
  },
});
if (!built.success) throw new AggregateError(built.logs);`,
};

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
      `${how}: a locale is kept under the name that Intl gives its tag`,
      async () => {
        using dir = tempDir("compile-trim-locales-names", programs);
        const folder = String(dir);
        // Intl reads `in` as `id`, `iw` as `he` and `mo` as `ro`, and opens the data of those names.
        const build = ["build", "--compile", ...flags, ...withoutDebugInformation, "--trim", "tags.ts"];
        const listed = [...build, "--trim-locales=in,iw,mo,sh,tl_PH,en", "--outfile", "listed"];
        // The command line is read before the engine starts, here with a locale of the host that ICU cannot read.
        const host = { ...bunEnv, LANG: "abcdefghijkl", LC_ALL: "abcdefghijkl", LC_MESSAGES: "abcdefghijkl" };
        expect(await run([bunExe(), ...listed], folder, host)).toMatchObject({ exitCode: 0 });
        // The same languages through Bun.build: one as POSIX names a locale, and one as a tag whose canonical form
        // is longer than the buffer that it is first written to.
        const long = "mo-u-ca-gregory-co-standard-cu-mdl-fw-mon-hc-h23-ms-metric-nu-latn-tz-mdkiv";
        const locales = ["in", "iw_IL.UTF-8", long, "sh", "tl_PH", "en"];
        const api = ["build-tags.ts", flags.length > 0 ? "aot" : "bundle", join(folder, "api"), ...locales];
        const startsFrom = { ...bunEnv, STARTS_FROM: copyWithoutDebugInformation };
        expect(await run([bunExe(), ...api], folder, startsFrom)).toMatchObject({ exitCode: 0 });

        const tags = ["in", "id", "iw", "he", "mo", "ro", "sh", "tl"];
        const whole = await run([bunExe(), "tags.ts", ...tags], folder);
        expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
        expect(await run([join(folder, "listed"), ...tags], folder)).toEqual(whole);
        expect(await run([join(folder, "api"), ...tags], folder)).toEqual(whole);
        // The system's ICU has every language.
        if (isMacOS) return;
        expect(await run([join(folder, "listed"), "de"], folder)).toMatchObject({ exitCode: 70 });
        // Intl reads `hy-arevmda` as `hyw`, which has no data. The build says so of the tag as it is written.
        const refused = [...build, "--trim-locales=hy-arevmda", "--outfile", "refused"];
        expect(await run([bunExe(), ...refused], folder)).toMatchObject({
          stderr: expect.stringContaining('has no data for the locale "hy-arevmda"'),
          exitCode: 1,
        });
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
            stderr: `error: the locale data this program needs was removed by --trim. Add the locale to compile.trim.locales to keep it.${isWindows ? "\r\n" : "\n"}`,
            exitCode: 70,
          });
        }
      },
    );
  }
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
            ["de", "de-AT", "en", "fr", "ja"].map(async tag => {
              const { stdout, exitCode } = await run([executable, tag], folder);
              return [tag, exitCode === 0 ? stdout.trim() : exitCode];
            }),
          );
          const { size } = statSync(isWindows ? executable + ".exe" : executable);
          return { how, size, months: Object.fromEntries(months) };
        };
        const executables = await Promise.all(ways.map((way, index) => inTurn(() => buildAndRun(way, index))));
        const removed = { en: 70, fr: 70, ja: 70 };
        const fromTheSystemsIcu = { en: "January", fr: "janvier", ja: "1月" };
        const months = { de: "Januar", "de-AT": "Jänner", ...(isMacOS ? fromTheSystemsIcu : removed) };
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
