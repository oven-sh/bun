// The same program built again and again yields the same executable, byte for byte. The compiler works on many threads, and a fact that one
// of them writes while another reads shows up as an executable that differs once in some hundred builds, and then behaves differently.
//
//   bun test test/aot/repeated-builds                            a few builds of each program, all at once so that the threads disturb each other
//   AOT_REPEATED_BUILDS=300 bun test test/aot/repeated-builds    as many of each
//   AOT_PROGRAMS=<text> bun test test/aot/repeated-builds        the programs whose path contains the text
//
// A build counts by its exit code and by the bytes it wrote. A build that fails is a failure, not a missing sample.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { dirname, join } from "path";
import { spawned, unsupported, wanted } from "./run-programs";

const builds = Number(process.env.AOT_REPEATED_BUILDS) || 6;
const atOnce = Math.max(2, Math.min(builds, availableParallelism()));
const programs = [
  // What it prints depends on which methods the compiler has seen their classes assign to.
  "repeated-builds/methods-reassigned-by-class.ts",
  "programs/typed-objects/field-on-few-union-members.ts",
  "programs/classes-and-closures/structural-subtypes.ts",
  "programs/async-and-generators/async-function-forms.ts",
  "programs/strings/equality-switch-plus-and-templates-untyped.js",
  "programs/commonjs/typed-requires-typed/main.ts",
  "programs/objects/literal-accessors-with-data-members.ts",
  "programs/untyped-code/counter-compared-with-length.js",
];
const root = String(tempDir("aot-repeated-builds", {}));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("compile/aot/repeated builds", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const program of programs) {
    if (wanted === "quick" ? program !== programs[0] : !program.includes(wanted)) continue;
    test(
      program,
      async () => {
        const path = join(import.meta.dir, program);
        const found = new Map<string, number>();
        let next = 0;
        const lane = async (number: number) => {
          const executable = join(root, program.replaceAll(/[^a-z]+/g, "-"), String(number), isWindows ? "program.exe" : "program");
          mkdirSync(dirname(executable), { recursive: true });
          while (next++ < builds) {
            // More threads than most machines have cores: they get in each other's way more often.
            const build = await spawned([bunExe(), "build", "--compile", "--aot", path, "--outfile", executable], dirname(path), { ...bunEnv, WTF_numberOfProcessorCores: "32" });
            const outcome = build.exitCode === 0 && !build.signal ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex") : `exit code ${build.exitCode} ${build.signal ?? ""} ${build.stderr.slice(0, 300)}`;
            found.set(outcome, (found.get(outcome) ?? 0) + 1);
            rmSync(executable, { force: true });
          }
        };
        await Promise.all(Array.from({ length: atOnce }, (_, number) => lane(number)));
        expect([...found.values()]).toEqual([builds]);
        expect([...found.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
      },
      builds * 60_000,
    );
  }
});
