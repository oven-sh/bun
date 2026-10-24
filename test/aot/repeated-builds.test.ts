// The same program built again and again yields the same executable, byte for byte, whatever the number of threads. The compiler works on
// many threads, and a fact that one of them writes while another reads shows up once in some hundred builds: as a build that aborts, as a build
// that reports an error of the compiler, or as an executable that differs and then behaves differently.
//
//   bun test test/aot/repeated-builds                            a few builds of each program, all at once so that the threads disturb each other
//   AOT_REPEATED_BUILDS=300 bun test test/aot/repeated-builds    as many of each
//   AOT_PROGRAMS=<text> bun test test/aot/repeated-builds        the programs whose path contains the text
//
// A build counts by its exit code and by the bytes it wrote. A build that fails is a failure, not a missing sample.
//
// A race passes "the same bytes at 1, 16 and 64 threads" 97 to 99 times of 100. So a program on which one has shown is built more often than the
// others, and what one run of this file lets through the next ones catch: a test of this file that fails now and then is a race, never a flake.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { dirname, join } from "path";
import { withThreads } from "./harness/flags";
import { spawned, unsupported, wanted, withoutDebugInformation } from "./run-programs";

const requested = Number(process.env.AOT_REPEATED_BUILDS);
const isSlowBun = isASAN || isDebug;
// Fewer threads than cores, as many, and many more: threads that wait for a core stop at other places than threads that run.
const threadCounts = [1, 2, 5, 16, 64];

const programs: { path: string; builds: number; flags?: string[] }[] = [
  // What it prints depends on which methods the compiler has seen their classes assign to.
  { path: "repeated-builds/methods-reassigned-by-class.ts", builds: 6 },
  { path: "programs/typed-objects/field-on-few-union-members.ts", builds: 6 },
  { path: "programs/classes-and-closures/structural-subtypes.ts", builds: 6 },
  { path: "programs/async-and-generators/async-function-forms.ts", builds: 6 },
  { path: "programs/strings/equality-switch-plus-and-templates-untyped.js", builds: 6 },
  { path: "programs/commonjs/typed-requires-typed/main.ts", builds: 6 },
  { path: "programs/objects/literal-accessors-with-data-members.ts", builds: 6 },
  { path: "programs/untyped-code/counter-compared-with-length.js", builds: 6 },
  // Steps of the flow analysis ran side by side, and one of them opened a phase of the type table while another held an arena of it: 5 builds of 200 aborted.
  { path: "programs/relational-summaries/accessors-arrive-on-the-chain-in-every-way.js", builds: 40 },
  // The same race, 9 builds of 300. And it pulls in enough of Bun's library that code is generated on every thread for a while: the body of a function was
  // released when its code was emitted, while the thread that compiled a caller asked whether the function has a body: 3 builds of 200 reported a call of a function without code.
  { path: "programs/native-callbacks/callbacks-net-sockets-and-their-events.ts", builds: 40, flags: ["--target=bun"] },
  // Whether a member that some objects lack is found above them is asked of a table that another step of the flow analysis fills.
  { path: "programs/objects/a-member-named-tojson-that-only-some-objects-get.js", builds: 12 },
];

const root = String(tempDir("aot-repeated-builds", {}));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("compile/aot/repeated builds", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  const carrier = withoutDebugInformation();
  for (const { path: program, builds: usualBuilds, flags = [] } of programs) {
    if (wanted === "quick" ? program !== programs[0].path : !program.includes(wanted)) continue;
    const builds = requested || (isSlowBun ? Math.min(usualBuilds, threadCounts.length) : usualBuilds);
    // Each build takes some hundred megabytes, so not one for each core of a large machine.
    const atOnce = Math.max(2, Math.min(builds, availableParallelism(), 12));
    test(
      program,
      async () => {
        const path = join(import.meta.dir, program);
        const found = new Map<string, number[]>();
        let next = 0;
        const lane = async (number: number) => {
          // An executable holds its own name, so all have one name, each in a folder of its lane.
          const executable = join(
            root,
            program.replaceAll(/[^a-z]+/g, "-"),
            String(number),
            isWindows ? "program.exe" : "program",
          );
          mkdirSync(dirname(executable), { recursive: true });
          for (let build = next++; build < builds; build = next++) {
            const threads = threadCounts[build % threadCounts.length];
            const built = await spawned(
              [
                bunExe(),
                "build",
                "--compile",
                "--aot",
                withThreads(threads),
                ...carrier,
                ...flags,
                path,
                "--outfile",
                executable,
              ],
              dirname(path),
              bunEnv,
            );
            const outcome =
              built.exitCode === 0 && !built.signal
                ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex")
                : `exit code ${built.exitCode} ${built.signal ?? ""} ${built.stderr.slice(0, 600)}`;
            found.set(outcome, [...(found.get(outcome) ?? []), threads]);
            rmSync(executable, { force: true });
          }
        };
        await Promise.all(Array.from({ length: atOnce }, (_, number) => lane(number)));
        const outcomes = [...found].map(([outcome, threads]) => ({
          outcome: /^[0-9a-f]{64}$/.test(outcome) ? "built" : outcome,
          builds: threads.length,
        }));
        expect(outcomes).toEqual([{ outcome: "built", builds }]);
      },
      builds * 60_000,
    );
  }
});
