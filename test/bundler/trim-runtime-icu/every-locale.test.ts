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
const features = ["intl", "collation", "units", "formatting"];

using probe = tempDir("trim-runtime-icu-probe", { "hello.ts": `console.log("hello world");` });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stdout: "pipe",
  stderr: "pipe",
});
const hasIslands = !probed.stderr.toString().includes("nothing can be left out of this Bun");

const environments: Record<string, string | undefined>[] = [
  { TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" },
  { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
  { TZ: undefined, LANG: "C" },
];

describe.skipIf(!hasIslands || !!unsupported)("a method keeps all that it can open of ICU's data, in every locale", () => {
  const programs: [entry: string, kept: string[]][] = [
    ["names-none-of-them.js", []],
    ["locale-compare.js", ["collation"]],
    ["date-to-locale-date-string.js", ["formatting"]],
    ["date-to-locale-time-string.js", ["formatting"]],
    ["date-to-locale-string.js", ["formatting", "units"]],
    ["number.js", ["formatting", "units"]],
  ];
  test.concurrent.each(programs)(
    "%s prints the same with only %j kept",
    async (entry, kept) => {
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
        expect(whole.stdout).toMatch(/: \d{4,} calls, \d+ threw, digest [0-9a-f]+\n$/);
        expect(await run([join(folder, "by-its-own-facts")], folder, env)).toEqual(whole);
        expect(await run([join(folder, "trimmed")], folder, env)).toEqual(whole);
      }
    },
    600_000,
  );
});
