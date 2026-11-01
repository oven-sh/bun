// `bun test --aot` is there to say whether the executable works, so it has to run the executable's code. ../a-test-run-compiles-what-an-executable-compiles.test.ts
// asks that of small programs, and they flatter: what opens a real program is a package that hands a namespace object on, reads require.cache or requires
// by a name it puts together. So three servers of ./app are each built twice here: as an executable, and as a test file that does nothing but import the
// server. No spy, no mock, nothing is taken out of require.cache: whatever differs, no test asked for it.
//
// The compiler's map lists every function it made: its file and position, its name, which form of it (typed, generic ..) and how many bytes. A function
// counts as equal where the test run has a function with the same five. The share of the executable's functions that are equal is held from below.
//
//   The floor of the method is 99.7%: an executable whose entry point only imports the server, against the server built by itself.
//   A share that falls: something new asks "is this a test run?", or a rule for tests got wider. docs/compiler/debugging.mdx, "What differs from an
//   executable", is the list of what may. A rule for what some test might do belongs behind what the files of the run do.
//   A share that rises: raise the number here. It prints one line a server that begins with EQUAL.
import { expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll } from "../harness/declare";
import { raiseDefaultTimeout } from "../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { copyApp } from "./run-servers";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

/** Percent of the executable's functions, rounded down, on Linux x64, less one: a landing that moves ten functions of two thousand is not meant. */
const equalAtLeast: Record<string, number> = {
  hono: 98,
  fastify: 58,
  express: 29,
};
const servers = Object.keys(equalAtLeast);

/** `file position name form bytes` of each function that is written in the server's files or in a package, with a number where several are alike. */
function functionsOfProgram(mapPath: string): Set<string> {
  const seen = new Map<string, number>();
  const functions = new Set<string>();
  for (const row of readFileSync(mapPath, "latin1").split("\n")) {
    const columns = row.split("\t");
    const path = columns[10] ?? "";
    if (columns[0] !== "F" || path.includes(".test.ts")) continue;
    const inPackage = path.lastIndexOf("/node_modules/");
    const inApp = path.lastIndexOf("/app/");
    // An executable puts its files under a root of its own.
    const file =
      inPackage >= 0
        ? path.slice(inPackage)
        : inApp >= 0
          ? path.slice(inApp)
          : path.startsWith("/$bunfs/root/")
            ? "/app/" + path.slice(13)
            : "";
    if (!file) continue;
    const key = `${file} ${columns[11]} ${columns[7]} ${columns[8]}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    functions.add(`${key} #${count} ${columns[3]}`);
  }
  return functions;
}

// The forms are the same on every platform. The bytes are not, and neither are the files that a package loads.
describe.skipIf(!isLinux || process.arch !== "x64")("a test run compiles what an executable compiles: servers", () => {
  const work = String(tempDir("aot-servers-both-ways", {}));
  const app = join(work, "app");
  const shares = new Map<string, { equal: number; executable: number; testRun: number }>();
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  beforeAll(async () => {
    await copyApp(app);
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
          const run = await spawned([bunExe(), "test", "--aot", `./${name}.test.ts`], app, withMap("test-run"));
          expect({ stderr: run.exitCode ? run.stderr : "", exitCode: run.exitCode }).toEqual({
            stderr: "",
            exitCode: 0,
          });
          const [ofExecutable, ofTestRun] = [
            functionsOfProgram(map("executable")),
            functionsOfProgram(map("test-run")),
          ];
          shares.set(name, {
            equal: [...ofExecutable].filter(it => ofTestRun.has(it)).length,
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
});
