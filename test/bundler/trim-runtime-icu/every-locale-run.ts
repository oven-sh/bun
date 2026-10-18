import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../../aot/run-programs";

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
const features = ["segmenter", "display_names", "intl", "collation", "units", "date_formatting", "number_formatting"];

using probe = tempDir("trim-runtime-icu-probe", { "hello.ts": `console.log("hello world");` });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

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
  ["date-to-locale-date-string.js", ["date_formatting"]],
  ["date-to-locale-time-string.js", ["date_formatting"]],
  ["date-to-locale-string.js", ["date_formatting"]],
  ["intl-date-time-format.js", ["date_formatting"]],
  ["intl-relative-time-format.js", ["intl", "number_formatting"]],
  ["number.js", ["number_formatting", "units"]],
  ["intl-display-names.js", ["display_names"]],
  ["intl-duration-format.js", ["number_formatting", "units"]],
  ["intl-number-format.js", ["number_formatting", "units"]],
  ["intl-plural-rules.js", ["intl", "number_formatting"]],
  ["locale-compare.js", ["collation"]],
  ["intl-collator.js", ["collation"]],
  ["intl-list-format.js", ["intl"]],
  ["intl-segmenter.js", ["segmenter"]],
  ["intl-locale.js", ["intl", "collation"]],
  ["intl-supported-values-of.js", ["intl", "collation"]],
  ["intl-get-canonical-locales.js", ["intl"]],
  ["names-none-of-them.js", []],
];
const mostProgramsInAPart = 5;

function partNumbers() {
  return readdirSync(import.meta.dir)
    .flatMap(name => /^every-locale-(\d+)\.test\.ts$/.exec(name)?.slice(1) ?? [])
    .map(Number)
    .sort((a, b) => a - b);
}

export function testDeal() {
  test("the files every-locale-<n>.test.ts are numbered from 1 with no gap", () => {
    const numbers = partNumbers();
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  test(`no part holds more than ${mostProgramsInAPart} programs`, () => {
    const parts = partNumbers().length;
    expect(
      Math.ceil(programs.length / parts),
      `A test file has three minutes in CI. Add test/bundler/trim-runtime-icu/every-locale-${parts + 1}.test.ts, a copy of the one before it with its number raised.`,
    ).toBeLessThanOrEqual(mostProgramsInAPart);
  });

  test("every program is in the table", () => {
    const entries = Object.keys(files).filter(name => name !== "lists.js" && name !== "date.js");
    expect(programs.map(([entry]) => entry).sort()).toEqual(entries.sort());
  });
}

export function testPrograms(part: number) {
  const parts = partNumbers().length;

  describe.skipIf(!hasIslands || !!unsupported)("a method keeps all that it can open of ICU's data, in every locale", () => {
    test.concurrent.each(programs.filter((_, index) => index % parts === part - 1))(
      "%s prints the same with only %j kept",
      (entry, kept) =>
        withSlot(async () => {
          using dir = tempDir("trim-runtime-icu", files);
          const folder = String(dir);
          const leftOut = features.filter(feature => !kept.includes(feature)).join(",");
          const contents: Record<string, string> = {};
          for (const [outfile, options, without] of [
            ["whole", [], undefined],
            ["by-its-own-facts", ["--compile-trim-runtime"], undefined],
            ["trimmed", ["--compile-trim-runtime"], leftOut],
          ] as const) {
            const built = await run([bunExe(), "build", "--compile", "--aot", ...options, entry, "--outfile", join(outfile, "program")], folder, {
              ...bunEnv,
              BUN_TRIM_RUNTIME_WITHOUT: without,
            });
            expect(built.stderr).not.toContain("error:");
            expect(built.exitCode).toBe(0);
            const bytes = readFileSync(join(folder, outfile, isWindows ? "program.exe" : "program"));
            contents[outfile] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
          }
          const executables = contents["trimmed"] === contents["by-its-own-facts"] ? ["whole", "trimmed"] : ["whole", "by-its-own-facts", "trimmed"];
          for (const environment of environments) {
            const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
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
