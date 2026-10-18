import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
  { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
  { TZ: undefined, LANG: "C" },
];

describe.skipIf(!hasIslands || !!unsupported)("a method keeps all that it can open of ICU's data, in every locale", () => {
  const programs: [entry: string, kept: string[]][] = [
    ["names-none-of-them.js", []],
    ["locale-compare.js", ["collation"]],
    ["date-to-locale-date-string.js", ["date_formatting"]],
    ["date-to-locale-time-string.js", ["date_formatting"]],
    ["date-to-locale-string.js", ["date_formatting"]],
    ["number.js", ["number_formatting", "units"]],
    ["intl-collator.js", ["collation"]],
    ["intl-date-time-format.js", ["date_formatting"]],
    ["intl-display-names.js", ["display_names"]],
    ["intl-duration-format.js", ["number_formatting", "units"]],
    ["intl-get-canonical-locales.js", ["intl"]],
    ["intl-list-format.js", ["intl"]],
    ["intl-locale.js", ["intl", "collation"]],
    ["intl-number-format.js", ["number_formatting", "units"]],
    ["intl-plural-rules.js", ["intl", "number_formatting"]],
    ["intl-relative-time-format.js", ["intl", "number_formatting"]],
    ["intl-segmenter.js", ["segmenter"]],
    ["intl-supported-values-of.js", ["intl", "collation"]],
  ];
  test.concurrent.each(programs)(
    "%s prints the same with only %j kept",
    (entry, kept) => withSlot(async () => {
      using dir = tempDir("trim-runtime-icu", files);
      const folder = String(dir);
      const leftOut = features.filter(feature => !kept.includes(feature)).join(",");
      for (const [outfile, options, without] of [
        ["whole", [], undefined],
        ["by-its-own-facts", ["--compile-trim-runtime"], undefined],
        ["trimmed", ["--compile-trim-runtime"], leftOut],
      ] as const) {
        const built = await run([bunExe(), "build", "--compile", "--aot", ...options, entry, "--outfile", outfile], folder, { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without });
        expect(built.stderr).not.toContain("error:");
        expect(built.exitCode).toBe(0);
      }
      for (const environment of environments) {
        const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
        const whole = await run([join(folder, "whole")], folder, env);
        expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
        expect(whole.stdout).toMatch(/: \d+ calls, \d+ threw, digest [0-9a-f]+\n$/);
        expect(await run([join(folder, "by-its-own-facts")], folder, env)).toEqual(whole);
        expect(await run([join(folder, "trimmed")], folder, env)).toEqual(whole);
      }
    }),
    1_800_000,
  );
});
