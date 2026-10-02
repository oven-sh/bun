import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";
import { join } from "path";

const supported = isArm64 && !isWindows;
const programs = join(import.meta.dir, "compile-aot");

async function run(name: string, env: Record<string, string>) {
  const dir = join(programs, name);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", existsSync(join(dir, "main.ts")) ? "main.ts" : "main.js"],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1", ...env },
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const withoutAOTLogLines = (stderr: string) => stderr.replace(/^\[aot\] .*\n/gm, "");

const heavy = new Set(["internals", "short"]);

describe.skipIf(!supported)("compile.aot", () => {
  for (const name of readdirSync(programs)
    .filter(name => !name.startsWith("."))
    .sort((a, b) => Number(heavy.has(a)) - Number(heavy.has(b)))) {
    const it = heavy.has(name) ? test : test.concurrent;
    const reference = Promise.withResolvers<Awaited<ReturnType<typeof run>>>();
    it(`${name}: the same build, not compiled ahead of time`, async () => {
      const result = await run(name, {
        BUN_AOT: "0",
        BUN_JSC_useImmutableIntrinsics: "1",
        BUN_JSC_hideTextOfFunctionsForTesting: "1",
      });
      reference.resolve(result);
      expect(result.stderr).not.toContain("[aot] image: ");
      expect(result.stdout).not.toBe("");
    });

    for (const [label, options] of [
      ["ahead of time", ""],
      ["ahead of time, validated", "validateAOTInferredTypes=1,validateGraphAtEachPhase=1"],
      ["ahead of time, with several copies of the stubs", "numberOfAOTStubCopiesForTesting=3"],
      ["ahead of time, with every call through a veneer", "forceAOTVeneers=1"],
      [
        "ahead of time, with few function numbers",
        "largestAOTFunctionNumberInTypesForTesting=3,validateAOTInferredTypes=1",
      ],
    ]) {
      it(`${name}: ${label}`, async () => {
        const [expected, actual] = await Promise.all([
          reference.promise,
          run(name, options ? { BUN_AOT_OPTIONS: options } : {}),
        ]);
        expect(actual.stderr).toContain("[aot] image: ");
        expect(actual.stderr).not.toContain("[aot] not using");
        expect({ ...actual, stderr: withoutAOTLogLines(actual.stderr) }).toEqual({
          ...expected,
          stderr: withoutAOTLogLines(expected.stderr),
        });
      });
    }
  }
});
