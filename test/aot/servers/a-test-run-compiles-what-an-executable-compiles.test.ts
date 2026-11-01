// `bun test --aot` is there to say whether the executable works, so it has to run the executable's code. ../a-test-run-compiles-what-an-executable-compiles.test.ts
// asks that of small programs, and they flatter: what opens a real program is a package that hands a namespace object on, reads require.cache or requires
// by a name it puts together. So three servers of ./app are each built three times here: as an executable, as a test file that does nothing but import the
// server, and as that test file behind another one. No spy, no mock, nothing is taken out of require.cache: whatever differs, no test asked for it.
//
// The compiler's map lists every function it made: its file and position, its name, which form of it (typed, generic ..) and how many bytes. A function
// counts as equal where the test run has a function with the same five. The share of the executable's functions that are equal is held from below.
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

/** Percent of the executable's functions, rounded down, on Linux x64, less one: a landing that moves ten functions of two thousand is not meant. */
const equalAtLeast: Record<string, number> = {
  hono: 98,
  fastify: 71,
  express: 95,
};
/** The same where another test file runs first, as in every project with two. TODO: each is owed the number above. */
const equalBehindAnotherFileAtLeast: Record<string, number> = {
  hono: 92, // owed: 98
  fastify: 63, // owed: 71
  express: 77, // owed: 95
};
const servers = Object.keys(equalAtLeast);
type Shares = { equal: number; equalBehindAnotherFile: number; executable: number; testRun: number };

// The forms are the same on every platform. The bytes are not, and neither are the files that a package loads.
describe.skipIf(!isLinux || process.arch !== "x64")("a test run compiles what an executable compiles: servers", () => {
  const work = String(tempDir("aot-servers-both-ways", {}));
  const app = join(work, "app");
  const shares = new Map<string, Shares>();
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

  test.each(servers)("%s", name => {
    const { equal, executable, testRun } = shares.get(name)!;
    const percent = Math.floor((100 * equal) / executable);
    console.log(
      `EQUAL ${name}: ${percent}% (${equal} of the executable's ${executable} functions; the test run has ${testRun})`,
    );
    expect(executable).toBeGreaterThan(500);
    expect({ name, percent: Math.min(percent, equalAtLeast[name]) }).toEqual({ name, percent: equalAtLeast[name] });
  });

  test.each(servers)("%s, behind another test file", name => {
    const { equalBehindAnotherFile: equal, executable } = shares.get(name)!;
    const [percent, atLeast] = [Math.floor((100 * equal) / executable), equalBehindAnotherFileAtLeast[name]];
    console.log(
      `EQUAL ${name}, behind another test file: ${percent}% (${equal} of the executable's ${executable} functions)`,
    );
    expect({ name, percent: Math.min(percent, atLeast) }).toEqual({ name, percent: atLeast });
  });

  for (const name of servers)
    test.todo(`${name}: a test file is compiled alike wherever it stands in the run`, () => {
      const { equal, equalBehindAnotherFile } = shares.get(name)!;
      expect({ name, equalBehindAnotherFile }).toEqual({ name, equalBehindAnotherFile: equal });
    });
});
