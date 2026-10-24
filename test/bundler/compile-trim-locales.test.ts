// `--trim --trim-locales de` keeps the data of German and removes the other languages'. A program that asks for a language that was removed ends with exit code 70.
// ICU also opens the data of its own default locale, which it takes from the host: the first date format of a process makes a calendar in it. No program sees that locale
// (Bun's default is en-US on every host), so the language of the host decides nothing: not where it was removed, and not where the host has none (LANG=C is en_US_POSIX to ICU).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { run } from "../aot/harness/run";
import { unsupported } from "../aot/run-programs";

// Asked of the Bun under test itself, so that a release build, which has no bun:internal-for-testing, runs this file too.
const canTrim = (() => {
  using dir = tempDir("compile-trim-locales-probe", { "probe.ts": "" });
  const probed = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--trim", "probe.ts", "--outfile", "probe"],
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
  "removed.ts": `console.log(new Date(0).toLocaleDateString("fr", { timeZone: "UTC" }));`,
};

describe.skipIf(!canTrim)("--trim-locales", () => {
  for (const flags of [[], ["--aot"]]) {
    const how = ["--compile", ...flags].join(" ");

    test.skipIf(flags.length > 0 && !!unsupported)(
      `${how}: what is formatted in a locale that was kept does not depend on the locale of the host`,
      async () => {
        using dir = tempDir("compile-trim-locales", programs);
        const folder = String(dir);
        expect(
          await run(
            [bunExe(), "build", "--compile", ...flags, "--trim", "--trim-locales=de", "kept.ts", "--outfile", "kept"],
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
            ...(await run([join(folder, "removed")], folder, { ...bunEnv, LANG: host, LC_ALL: host })),
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
