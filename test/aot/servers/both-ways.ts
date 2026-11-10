// `bun test --aot` is there to say whether the executable works, so it has to run the executable's code. ../a-test-run-compiles-what-an-executable-compiles.test.ts
// asks that of small programs, and they flatter: what opens a real program is a package that hands a namespace object on, reads require.cache or requires
// by a name it puts together. So servers of ./app are each built three times here: as an executable, as a test file that does nothing but import the
// server, and as that test file behind another one. No spy, no mock, nothing is taken out of require.cache: whatever differs, no test asked for it.
//
// The compiler's map lists every function it made: its file and position, its name, which form of it (typed, generic ..), how many bytes, and each stub
// that its code calls with how often. A function counts as equal where the test run has a function with the same six. The share of the executable's
// functions that are equal is held from below.
//
//   The floor of the method is 99.7%: an executable whose entry point only imports the server, against the server built by itself.
//   A share that falls: something new asks "is this a test run?", or a rule for tests got wider. docs/compiler/debugging.mdx, "What differs from an
//   executable", is the list of what may. A rule for what some test might do belongs behind what the files of the run do.
//   A share that rises: raise the number here. It prints one line a server that begins with EQUAL.
import { expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll, raiseDefaultTimeout } from "../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../harness/flags";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { beforeAll, describe, testOneByOne as test } from "../supported";
import { functionsOfProgram } from "./functions-of-a-map";
import { copyApp } from "./run-servers";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

type Shares = { equal: number; equalBehindAnotherFile: number; executable: number; testRun: number };

/**
 * `equalAtLeast`: percent of the executable's functions, rounded down, on Linux x64, less one: a landing that moves ten functions of two thousand is not meant.
 * `equalBehindAnotherFileAtLeast`: the same where another test file runs first, as in every project with two. TODO: each is owed the number of the first.
 * `reachedSoFar`: where a floor is not met yet, the percent that is: the case on the floor is `failing`, with both numbers in its name, and turns red the day the floor is met; a second case holds what is reached, less one.
 * `fallenTo`: where a share has fallen below what that second case holds, the percent that it is today, and why. What is held stays: that a test run compiles less of what the executable compiles is
 * nothing for a number here to follow. The case is `failing`, with both numbers and the reason in its name, and turns red the day the share is back; one more case holds today's, less one.
 */
export function holdBothWays(
  equalAtLeast: Record<string, number>,
  equalBehindAnotherFileAtLeast: Record<string, number>,
  reachedSoFar: { equal?: Record<string, number>; equalBehindAnotherFile?: Record<string, number> } = {},
  fallenTo: { equal?: Record<string, number>; equalBehindAnotherFile?: Record<string, number>; why?: string } = {},
) {
  const servers = Object.keys(equalAtLeast);
  // The forms are the same on every platform. The bytes are not, and neither are the files that a package loads.
  describe.skipIf(!isLinux || process.arch !== "x64")(
    "a test run compiles what an executable compiles: servers",
    () => {
      const work = String(tempDir("aot-servers-both-ways", {}));
      const app = join(work, "app");
      const shares = new Map<string, Shares>();
      const sharesOf = (name: string) => shares.get(name)!;
      afterAll(() => rmSync(work, { recursive: true, force: true }));

      beforeAll(async () => {
        await copyApp(app);
        writeFileSync(join(app, "0-first.test.ts"), `import { test } from "bun:test";\ntest("first", () => {});\n`);
        await Promise.all(
          servers.map(name =>
            slot(async () => {
              const map = (kind: string) => join(work, `${name}.${kind}.map`);
              const withMap = (kind: string) => ({ ...bunEnv, PORT: "0", [buildEnvironment.mapFilePath]: map(kind) });
              const executable = join(work, `${name}-compiled${isWindows ? ".exe" : ""}`);
              built(await spawned([bunExe(), ...compileCommand, "--target=bun", `./${name}.ts`, "--outfile", executable], app, withMap("executable"))); // prettier-ignore
              rmSync(executable, { force: true });
              // The server listens from then on, so the one test ends the process.
              writeFileSync(
                join(app, `${name}.test.ts`),
                `import { test } from "bun:test";\nimport "./${name}.ts";\ntest("is loaded", () => process.exit(0));\n`,
              );
              const filesAheadOf = { "test-run": [], "test-run-behind-another-file": ["./0-first.test.ts"] };
              for (const [kind, filesAhead] of Object.entries(filesAheadOf)) {
                const command = [bunExe(), "test", "--aot", ...filesAhead, `./${name}.test.ts`];
                const run = await spawned(command, app, withMap(kind));
                expect({ kind, stderr: run.exitCode ? run.stderr : "", exitCode: run.exitCode }).toEqual({
                  kind,
                  stderr: "",
                  exitCode: 0,
                });
              }
              const [ofExecutable, ofTestRun, ofTestRunBehindAnotherFile] = [
                functionsOfProgram(map("executable")),
                functionsOfProgram(map("test-run")),
                functionsOfProgram(map("test-run-behind-another-file")),
              ];
              shares.set(name, {
                equal: [...ofExecutable].filter(it => ofTestRun.has(it)).length,
                equalBehindAnotherFile: [...ofExecutable].filter(it => ofTestRunBehindAnotherFile.has(it)).length,
                executable: ofExecutable.size,
                testRun: ofTestRun.size,
              });
            }),
          ),
        );
      }, 900_000);

      const ways = [
        {
          where: "",
          share: "equal",
          atLeast: equalAtLeast,
          reached: reachedSoFar.equal ?? {},
          fallen: fallenTo.equal ?? {},
        },
        {
          where: ", behind another test file",
          share: "equalBehindAnotherFile",
          atLeast: equalBehindAnotherFileAtLeast,
          reached: reachedSoFar.equalBehindAnotherFile ?? {},
          fallen: fallenTo.equalBehindAnotherFile ?? {},
        },
      ] as const;
      for (const { where, share, atLeast, reached, fallen } of ways)
        for (const name of servers) {
          const percentOf = (all: Shares) => Math.floor((100 * all[share]) / all.executable);
          const holdsAtLeast = (held: number) => () => {
            const all = sharesOf(name);
            const percent = percentOf(all);
            console.log(
              `EQUAL ${name}${where}: ${percent}% (${all[share]} of the executable's ${all.executable} functions; the test run has ${all.testRun})`,
            );
            expect(all.executable).toBeGreaterThan(500);
            expect({ name, percent: Math.min(percent, held) }).toEqual({ name, percent: held });
          };
          const held = name in reached ? reached[name] - 1 : atLeast[name];
          if (name in fallen) {
            test.failing(
              `${name}${where}: what is reached: ${fallen[name]}% for a floor of ${held}%: ${fallenTo.why}`,
              holdsAtLeast(held),
            );
            test(`${name}${where}: what is reached today`, holdsAtLeast(fallen[name] - 1));
          } else test(`${name}${where}: what is reached`, holdsAtLeast(held));
          if (name in reached)
            test.failing(`${name}${where}: ${reached[name]}% for a floor of ${atLeast[name]}%`, () => {
              const percent = percentOf(sharesOf(name));
              expect({ name, percent: Math.min(percent, atLeast[name]) }).toEqual({ name, percent: atLeast[name] });
            });
        }

      // Where the two shares that are reached are one number, the two counts are held to be one.
      for (const name of servers) {
        const reached = reachedSoFar.equal?.[name] ?? equalAtLeast[name];
        const reachedBehindAnotherFile =
          reachedSoFar.equalBehindAnotherFile?.[name] ?? equalBehindAnotherFileAtLeast[name];
        (reached === reachedBehindAnotherFile ? test : test.todo)(
          `${name}: a test file is compiled alike wherever it stands in the run`,
          () => {
            const { equal, equalBehindAnotherFile } = shares.get(name)!;
            expect({ name, equalBehindAnotherFile }).toEqual({ name, equalBehindAnotherFile: equal });
          },
        );
      }
    },
  );
}
