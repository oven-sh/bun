import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";
import { join } from "path";

// Each directory of compile-aot/ is a program that prints what it computes. Together they cover every way of calling a
// function, reading a variable, iterating, and so on, including the ways that throw. The output must be the same with
// and without ahead-of-time compilation.
//
// The reference is the same build, run without its machine code (BUN_AOT=0: from its bytecode). It is not `bun run`,
// which does not bundle: a bundle differs from its sources in the text of functions and of some error messages, and
// allows a top-level `const` to be read before it is initialized.
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

// These import much of node:*, whose modules are compiled along with the program. They run serially, after the others,
// because the compiler uses every core.
const heavy = new Set(["internals", "short"]);

describe.skipIf(!supported)("compile.aot", () => {
  for (const name of readdirSync(programs)
    .filter(name => !name.startsWith("."))
    .sort((a, b) => Number(heavy.has(a)) - Number(heavy.has(b)))) {
    const it = heavy.has(name) ? test : test.concurrent;
    // Built-in objects are immutable in ahead-of-time compiled code, and some of the programs try to modify them.
    const reference = Promise.withResolvers<Awaited<ReturnType<typeof run>>>();
    it(`${name}: without its machine code`, async () => {
      const result = await run(name, { BUN_AOT: "0", BUN_JSC_useImmutableIntrinsics: "1" });
      reference.resolve(result);
      expect(result.stderr).toContain("[aot] not using the image: useAOT is off");
      expect(result.stdout).not.toBe("");
    });

    for (const [label, options] of [
      ["ahead of time", ""],
      // Every type the compiler inferred is checked against the value, and the B3 and Air validators run after every phase.
      ["ahead of time, validated", "validateAOTInferredTypes=1,validateGraphAtEachPhase=1"],
      // Features that a program only needs once it has 96 MB of code: several copies of the stubs, and veneers for
      // calls that are out of range.
      ["ahead of time, with several copies of the stubs", "numberOfAOTStubCopiesForTesting=3"],
      ["ahead of time, with every call through a veneer", "forceAOTVeneers=1"],
      // And once it has 262,144 functions: function numbers that do not fit in a type.
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
