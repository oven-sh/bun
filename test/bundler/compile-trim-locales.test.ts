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
  "numbered.ts": `
const asked = process.argv.slice(2);
for (let at = 0; at < asked.length; at += 2) {
  const options = { timeZone: "UTC", dateStyle: asked[at + 1] as "full" };
  console.log(asked[at], new Date(0).toLocaleDateString(asked[at], options), new Intl.DateTimeFormat(asked[at], options).format(0));
}`,
  "numbered-by-use.ts": `
const dateStyle = process.argv[2] as "full";
console.log(new Intl.DateTimeFormat("ja-u-ca-japanese", { timeZone: "UTC", dateStyle }).format(0));
console.log(new Intl.DateTimeFormat("he-u-ca-hebrew", { timeZone: "UTC", dateStyle }).format(0));`,
};

// Each of these date patterns names a numbering system for one of its fields, as ja with the japanese calendar does for the first year of an era.
// ICU makes the rules of that system into number formats, and must not read the currency names of its default locale for them: they can be removed.
const numbered = [
  ["ja-u-ca-japanese", "full"],
  ["he-u-ca-hebrew", "long"],
  ["yi-u-ca-hebrew", "long"],
  ["haw", "short"],
  ["zh-u-ca-chinese", "full"],
].flat();

const inEveryHost = (cmd: string[], folder: string) =>
  Promise.all(
    hosts.map(async host => ({
      host,
      ...(await run(cmd, folder, { ...bunEnv, LANG: host, LC_ALL: host, LC_MESSAGES: host })),
    })),
  );

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
        expect(await inEveryHost([join(folder, "kept")], folder)).toEqual(hosts.map(host => ({ host, ...expected })));
      },
    );

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: a date whose pattern names a numbering system is formatted in a locale that was kept, whatever the locale of the host`,
      async () => {
        using dir = tempDir("compile-trim-locales-numbered", programs);
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
              "--trim-locales=ja,he,yi,haw,zh",
              "numbered.ts",
              "--outfile",
              "numbered",
            ],
            folder,
          ),
        ).toMatchObject({ exitCode: 0 });
        const expected = await run([bunExe(), "numbered.ts", ...numbered], folder);
        expect(expected).toMatchObject({ stderr: "", exitCode: 0 });
        expect(await inEveryHost([join(folder, "numbered"), ...numbered], folder)).toEqual(
          hosts.map(host => ({ host, ...expected })),
        );
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

  test.skipIf(!!unsupported)(
    "--compile --aot: such a date is formatted in the locales that the program names, which are the ones kept without --trim-locales",
    async () => {
      using dir = tempDir("compile-trim-locales-numbered-by-use", programs);
      const folder = String(dir);
      const build = (name: string, ...locales: string[]) =>
        run(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation,
            "--trim",
            ...locales,
            "numbered-by-use.ts",
            "--outfile",
            name,
          ],
          folder,
        );
      const sizeOf = (name: string) => statSync(join(folder, isWindows ? name + ".exe" : name)).size;
      expect(await build("by-use")).toMatchObject({ exitCode: 0 });
      expect(await build("listed", "--trim-locales=ja,he")).toMatchObject({ exitCode: 0 });
      // Without the list the build removed the same locales.
      expect(sizeOf("by-use")).toBe(sizeOf("listed"));
      const expected = await run([bunExe(), "numbered-by-use.ts", "long"], folder);
      expect(expected).toMatchObject({ stderr: "", exitCode: 0 });
      expect(await inEveryHost([join(folder, "by-use"), "long"], folder)).toEqual(
        hosts.map(host => ({ host, ...expected })),
      );
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
