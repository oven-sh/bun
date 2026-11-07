// What the type checker answers at one of its limits depends on what it was asked before. `Reversed<T>` below takes a step for
// each element of T, and the checker allows 100. But it remembers what it has worked out: where the build has asked for a tuple
// of 90 in one file, it gets one of 100 in the next in ten steps. The files meet in the checker alone.
//
// A build that is short of memory lowers its files in several passes, each with a checker that knows nothing yet
// (./two-passes-of-the-checker-come-where-memory-asks.test.ts). The first file of a later pass then asked for its tuple of 100
// from nothing and met the limit: its members came out without a type, and where the plain check of the file asks, the build was
// refused with TS2589, though tsc, `bun check` and a build in one pass accept the program. How a build is cut into passes may
// not show in the program. So where a file that is visited for good is refused a type for its depth, the build works out a part
// of that type from nothing, where it has all 100 steps, and visits the file again, which now finds that part known. What comes
// out is the type itself, whatever was asked before. It costs another visit of that one file and no further pass.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEnvironment, compileCommand, withProgramOutput, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const fileCount = 12;
const tuple = (element: number, length: number) => `[${Array(length).fill(element).join(", ")}]`;

interface Shape {
  /** A type that is over the limit wherever it is asked for. */
  hasTypeOverLimitInEveryFile: boolean;
  /** As much text again, behind these files, that asks for no such type: the second pass. */
  hasOtherHalf: boolean;
  /** A type that no number of steps finishes, in a generic interface, so that only the build asks for it. */
  hasTypeWithoutEnd?: boolean;
}

function files({ hasTypeOverLimitInEveryFile, hasOtherHalf, hasTypeWithoutEnd = false }: Shape) {
  let types = `export type Reversed<T extends unknown[]> = T extends [infer First, ...infer Rest] ? [...Reversed<Rest>, First] : [];\n`;
  types += `export type TooLong = ${tuple(9, 300)};\n`;
  types += `export type Grow<T extends unknown[]> = T extends unknown[] ? [0, ...Grow<[...T, 1]>] : never;\n`;
  let main = "";
  let sum = "0";
  const all: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
        types: [],
      },
    }),
  };
  // The files of a program are taken by their paths.
  const nameOf = (file: number) => `file${String(file).padStart(2, "0")}`;
  for (let file = 1; file <= fileCount; file++) {
    const names = ["A", "B", "C", "D"].map((letter, index) => `${letter}${(file + index) * 10}_${file}`);
    names.forEach((name, index) => (types += `export type ${name} = ${tuple(index, (file + index) * 10)};\n`));
    // A cut between two passes falls where the fewest references cross it.
    const before = hasOtherHalf && file > 1 ? `import { kept${file - 1} } from "./${nameOf(file - 1)}.ts";\n` : "";
    all[`${nameOf(file)}.ts`] = `import type { Grow, Reversed, TooLong, ${names.join(", ")} } from "./types.ts";
${before}interface Within${file}<A extends unknown[], B extends unknown[], C extends unknown[], D extends unknown[]> { a: Reversed<A>; b: Reversed<B>; c: Reversed<C>; d: Reversed<D> }
interface Over${file}<T extends unknown[]> { over: Reversed<T> }
interface Endless${file}<T extends unknown[]> { before: number; endless: Grow<T>; after: string }
const first: Within${file}<${names.join(", ")}> = JSON.parse("{}");
export function read${file}(text: string): number {
  const second: ${hasTypeOverLimitInEveryFile ? `Over${file}<TooLong>` : `Over${file}<[${file}]>`} = JSON.parse(text);
  ${hasTypeWithoutEnd ? `const third: Endless${file}<${names[0]}> = JSON.parse(text);\n  if (third === null) return 2;` : ""}
  return second === null ? 0 : 1;
}
export const kept${file}: number = first === null ? 0 : ${before ? `kept${file - 1} - kept${file - 1} + ` : ""}${file};
`;
    main += `import { read${file}, kept${file} } from "./${nameOf(file)}.ts";\n`;
    sum += ` + read${file}("{}") + kept${file}`;
    if (!hasOtherHalf) continue;
    const other = `other${String(file).padStart(2, "0")}`;
    const otherBefore = `other${String(file - 1).padStart(2, "0")}`;
    all[`${other}.ts`] =
      `${file > 1 ? `import { ${otherBefore} } from "./${otherBefore}.ts";\n` : ""}interface Pair${file} { left: number; right: string; note: "${"x".repeat(420)}" | undefined }
const pair: Pair${file} = { left: ${file}, right: "${file}", note: undefined };
export function ${other}(times: number): number {
  return pair.left * times + pair.right.length${file > 1 ? ` + ${otherBefore}(0)` : ""};
}
`;
    main += `import { ${other} } from "./${other}.ts";\n`;
    sum += ` + ${other}(2)`;
  }
  all["types.ts"] = types;
  all["main.ts"] = `${main}declare const console: { log(...values: unknown[]): void };\nconsole.log(${sum});\n`;
  return all;
}

async function build(shape: Shape, passCounts: number[]) {
  using dir = tempDir("aot-passes-change-no-answer", files(shape));
  const directory = String(dir);
  const expected = await run([bunExe(), "main.ts"], directory, bunEnv);
  expect(expected.exitCode).toBe(0);
  const programs: Record<string, string> = {};
  const lines: Record<string, number> = {};
  for (const passes of passCounts) {
    for (const threads of [1, 8]) {
      const program = join(directory, `program-${passes}-${threads}`);
      const executable = join(directory, `main-${passes}-${threads}${isWindows ? ".exe" : ""}`);
      const built = await run(
        [
          bunExe(),
          ...compileCommand,
          withThreads(threads),
          withProgramOutput(program),
          "main.ts",
          "--outfile",
          executable,
        ],
        directory,
        {
          ...bunEnv,
          BUN_DEBUG_TEST_AOT_WORDS: `TestRunCheckerPasses:${passes}`,
          [buildEnvironment.logsPhaseTimes]: "1",
        },
      );
      expect(built.exitCode).toBe(0);
      expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
      const key = `${passes} passes, ${threads} threads`;
      programs[key] = Bun.hash(readFileSync(program)).toString(16);
      // A build of more than one pass has a line for each.
      lines[key] = (built.stderr + built.stdout)
        .split("\n")
        .filter(line => line.startsWith("AOT pass of the checker | ")).length;
    }
  }
  const withOnePass = programs["1 passes, 1 threads"];
  expect(programs).toEqual(Object.fromEntries(Object.keys(programs).map(key => [key, withOnePass])));
  return lines;
}

test("a type is over the limit only for a checker that was not asked about the file before, and costs no further pass", async () => {
  const lines = await build({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: false }, [1, 2, 3]);
  expect(lines).toEqual({
    "1 passes, 1 threads": 0,
    "1 passes, 8 threads": 0,
    "2 passes, 1 threads": 2,
    "2 passes, 8 threads": 2,
    "3 passes, 1 threads": 3,
    "3 passes, 8 threads": 3,
  });
}, 240_000);

test("every file also has a type that is over the limit wherever it is asked for", async () => {
  await build({ hasTypeOverLimitInEveryFile: true, hasOtherHalf: false }, [1, 2, 3]);
}, 240_000);

// Such a type stays refused however much is worked out. tsc remembers what it had when it gave up, cut off wherever it happened to
// be, and the next file that asks finds that. The build remembers none of it, so every file is told the same by every checker.
test("every file also has a type without end", async () => {
  await build({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: false, hasTypeWithoutEnd: true }, [1, 2, 3]);
}, 240_000);

// On several threads the files are taken side by side, so most of them ask before the file in front of them has, and are lost at
// the limit. At the end of their pass they are taken in order and meet none.
test("a file that asks too early and meets no limit at the end of its own pass costs no further pass", async () => {
  const lines = await build({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: true }, [1, 2]);
  expect(lines).toEqual({
    "1 passes, 1 threads": 0,
    "1 passes, 8 threads": 0,
    "2 passes, 1 threads": 2,
    "2 passes, 8 threads": 2,
  });
}, 240_000);
