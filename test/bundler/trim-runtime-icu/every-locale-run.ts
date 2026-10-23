import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../../aot/run-programs";
import { canTrim, withoutFeatures } from "../compile-trim-features";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signalCode: child.signalCode };
}

const files = Object.fromEntries(
  readdirSync(import.meta.dir)
    .filter(name => name.endsWith(".js"))
    .map(name => [name, readFileSync(join(import.meta.dir, name), "utf8")]),
);
const features = ["IntlSegmenter", "IntlDisplayNames", "IntlOther", "IntlCollation", "IntlUnits", "IntlDateTimeFormat", "IntlNumberFormat"];

let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

const environments: Record<string, string | undefined>[] = [
  { TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" },
  { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", SOME_LOCALES: "1" },
  { TZ: undefined, LANG: "C", SOME_LOCALES: "1" },
];

const programs: [entry: string, kept: string[]][] = [
  ["date-to-locale-date-string.js", ["IntlDateTimeFormat"]],
  ["date-to-locale-time-string.js", ["IntlDateTimeFormat"]],
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

export function testDeal() {
  test("every program is in the table", () => {
    const entries = Object.keys(files).filter(name => name !== "lists.js" && name !== "date.js");
    expect(programs.map(([entry]) => entry).sort()).toEqual(entries.sort());
  });
}

export function testPrograms(part: number, parts: number) {
  describe.skipIf(!canTrim || !!unsupported)("a method keeps all that it can open of ICU's data, in every locale", () => {
    test.concurrent.each(programs.filter((_, index) => index % parts === part - 1))(
      "%s prints the same with only %j kept",
      (entry, kept) =>
        withSlot(async () => {
          using dir = tempDir("trim-runtime-icu", files);
          const folder = String(dir);
          const leftOut = features.filter(feature => !kept.includes(feature));
          const contents: Record<string, string> = {};
          for (const [outfile, options, without] of [
            ["whole", [], []],
            ["by-use", ["--trim"], []],
            ["trimmed", ["--trim"], leftOut],
          ] as const) {
            const built = await run([bunExe(), "build", "--compile", "--aot", ...options, ...withoutFeatures(without), entry, "--outfile", join(outfile, "program")], folder);
            expect(built.stderr).not.toContain("error:");
            expect(built.exitCode).toBe(0);
            const bytes = readFileSync(join(folder, outfile, isWindows ? "program.exe" : "program"));
            contents[outfile] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          }
          const executables = contents["trimmed"] === contents["by-use"] ? ["whole", "trimmed"] : ["whole", "by-use", "trimmed"];
          for (const environment of environments) {
            const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
            if (isMacOS) expect(await run([bunExe(), entry], folder, env)).toMatchObject({ stderr: "", exitCode: 0 });
            const [whole, ...others] = await Promise.all(executables.map(outfile => run([join(folder, outfile, "program")], folder, env)));
            expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
            expect(whole.stdout).toMatch(/: \d+ calls, \d+ threw, digest [0-9a-f]+\n$/);
            for (const other of others) expect(other).toEqual(whole);
          }
        }),
      1_800_000,
    );
  });
}
