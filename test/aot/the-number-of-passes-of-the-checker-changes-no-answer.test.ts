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
//
// The other thing that depends on what was asked before is a cycle: `module.exports = require("./common.js")(exports)` asks for
// the type of `exports`, which asks for what the module exports. Whoever runs into the cycle first gets what comes out around
// it, here the function that the call returns. Whoever asks later finds what was stored inside it, which is `any`. With one pass
// the first is the module itself. In a later pass it was the first file that requires the module, and that file alone was
// compiled with the better type. So a later pass begins by running into the cycles of the passes before, each from where it
// was run into then, and its files come later, as they do with one pass.
//
// A test run has one thing more that was asked before. A type error costs a tested file only the trust in its types, so all
// files are checked first, to decide that, and lowered afterwards. What that check had left behind told whoever lowered a file
// other types than an executable's build is told, which checks and lowers a file in one go: and a later pass, whose checker
// knows nothing, was told what the executable is told. Now the checker that decided goes, and a file is checked again where it
// is lowered.
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

// `own.js` is in front of the cut and `late.js` behind it, with as much text on either side.
function filesWithCycle({ isPickedByAnotherModule }: { isPickedByAnotherModule: boolean }) {
  const all: Record<string, string> = {
    "common.js": `function setup(env) { function made(name) { return name; } return made; } module.exports = setup;\n`,
    "own.js": `module.exports = require("./common.js")(exports);\n`,
    "other.js": `module.exports = require("./common.js")(exports);\n`,
    // As the package \`debug\` does.
    "picked.js": `if (typeof process === "undefined") { module.exports = require("./other.js"); } else { module.exports = require("./own.js"); }\n`,
  };
  const required = isPickedByAnotherModule ? "./picked.js" : "./own.js";
  let main = `const early = require("${required}");\n`;
  let sum = "0";
  for (let file = 1; file <= 6; file++) {
    all[`fill${file}.js`] =
      `exports.fill${file} = function (n) { return n * ${file}; };\n${`// ${"padding ".repeat(8)}\n`.repeat(8)}`;
    main += `const { fill${file} } = require("./fill${file}.js");\n`;
    sum += ` + fill${file}(1)`;
  }
  // As a transpiler writes a require that waits for its first use.
  all["late.js"] = `function _made() {
  const data = require("${required}");
  _made = function () {
    return data;
  };
  return data;
}
exports.late = _made()("late");
`;
  all["main.ts"] = `${main}const { late } = require("./late.js");\nconsole.log(typeof early, late, ${sum});\n`;
  return all;
}

async function build(all: Record<string, string>, passCounts: number[]) {
  using dir = tempDir("aot-passes-change-no-answer", all);
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
  const lines = await build(files({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: false }), [1, 2, 3]);
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
  await build(files({ hasTypeOverLimitInEveryFile: true, hasOtherHalf: false }), [1, 2, 3]);
}, 240_000);

// Such a type stays refused however much is worked out. tsc remembers what it had when it gave up, cut off wherever it happened to
// be, and the next file that asks finds that. The build remembers none of it, so every file is told the same by every checker.
test("every file also has a type without end", async () => {
  await build(files({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: false, hasTypeWithoutEnd: true }), [1, 2, 3]);
}, 240_000);

// On several threads the files are taken side by side, so most of them ask before the file in front of them has, and are lost at
// the limit. At the end of their pass they are taken in order and meet none.
test("a file that asks too early and meets no limit at the end of its own pass costs no further pass", async () => {
  const lines = await build(files({ hasTypeOverLimitInEveryFile: false, hasOtherHalf: true }), [1, 2]);
  expect(lines).toEqual({
    "1 passes, 1 threads": 0,
    "1 passes, 8 threads": 0,
    "2 passes, 1 threads": 2,
    "2 passes, 8 threads": 2,
  });
}, 240_000);

test("a file behind the cut requires a module whose export asks for its own exports", async () => {
  await build(filesWithCycle({ isPickedByAnotherModule: false }), [1, 2, 3]);
}, 240_000);

// Here the cycle is run into from the same place in every pass, and still only the first to get there sees around it.
test("a file behind the cut requires a module that picks one of two such modules", async () => {
  await build(filesWithCycle({ isPickedByAnotherModule: true }), [1, 2, 3]);
}, 240_000);

// Bun.build compiles on a thread of its own, which has less stack than a task of the checker may take. The task that goes around the cycles of the passes
// before ran on whatever thread had asked for the pass: "panic: the thread has too little stack for a task".
test("Bun.build takes more than one pass over files with such a cycle", async () => {
  using dir = tempDir("aot-passes-by-call", {
    ...filesWithCycle({ isPickedByAnotherModule: false }),
    "build.ts": `const built = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: true } as any });\nconsole.log(built.success);\n`,
  });
  const directory = String(dir);
  const expected = await run([bunExe(), "main.ts"], directory, bunEnv);
  for (const passes of [1, 2]) {
    const executable = join(directory, `by-call-${passes}${isWindows ? ".exe" : ""}`);
    const built = await run([bunExe(), "build.ts", executable], directory, {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: `TestRunCheckerPasses:${passes}`,
    });
    expect({
      stdout: built.stdout.trim(),
      panics: /panic.*/.exec(built.stderr)?.[0],
      exitCode: built.exitCode,
    }).toEqual({
      stdout: "true",
      panics: undefined,
      exitCode: 0,
    });
    expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
  }
}, 240_000);

// In each the type of an expression inside a function depends on how far the call around the function is resolved when the
// expression is first looked at.
function testedModule(name: string) {
  return `import { lstat } from "node:fs/promises";
import { bounded, isMissing } from "./shared.ts";
export async function ${name}(dir: string, ms: number = 50): Promise<boolean> {
  const found = await bounded(
    lstat(dir).catch((e: unknown) => (isMissing(e) ? undefined : Promise.reject(e))),
    ms,
  );
  return found === undefined;
}
export async function ${name}All(list: string[]) {
  const results = await Promise.allSettled(
    list.map(async (item, i) => {
      if (i === 7) {
        return Promise.reject(new Error("open"));
      }
      return item.length > 2 ? "delivered" : "refused";
    }),
  );
  return results.length;
}
function ${name}IsAncestor(a: string, b: string): Promise<boolean | null> {
  return Promise.resolve(a.length > b.length ? true : a === b ? null : false);
}
export function ${name}Tips(
  check: ((held: string) => Promise<"left" | null | boolean>) | undefined,
  held: string,
): Promise<readonly [boolean | null, boolean | null]> {
  const ask = () => Promise.all([${name}IsAncestor(held, "a"), ${name}IsAncestor("a", held)]);
  return check === undefined
    ? ask()
    : check(held).then(one => (one === "left" ? ask() : one === null ? [null, null] : [true, true]));
}
`;
}

function testedProject() {
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "passes", private: true }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
      },
    }),
    "src/shared.ts": `export function isMissing(e: unknown): boolean { return e instanceof Error && e.message === "missing"; }
export async function bounded<T>(work: Promise<T>, ms: number): Promise<T> { return ms > 0 ? work : await work; }
`,
    "src/early.ts": testedModule("early"),
    "src/late.ts": testedModule("late"),
  };
  for (const [test, name, fills] of [
    ["one", "early", [1, 2, 3]],
    ["two", "late", [4, 5, 6]],
  ] as const) {
    for (const fill of fills) {
      all[`src/fill${fill}.ts`] =
        `export function fill${fill}(n: number): number { return n * ${fill}; }\n${`// ${"padding ".repeat(8)}\n`.repeat(8)}`;
    }
    all[`tests/${test}.test.ts`] = `import { expect, test } from "bun:test";
${fills.map(fill => `import { fill${fill} } from "../src/fill${fill}.ts";`).join("\n")}
import { ${name}, ${name}All, ${name}Tips } from "../src/${name}.ts";
test("${name}", async () => {
  expect(await ${name}(".")).toBe(false);
  expect(await ${name}All(["a", "abc"])).toBe(2);
  expect(await ${name}Tips(async () => true, "x")).toEqual([true, true]);
  expect(${fills.map(fill => `fill${fill}(1)`).join(" + ")}).toBe(${fills.reduce((sum, fill) => sum + fill, 0)});
});
`;
  }
  return all;
}

test("the programs of a test run are the same bytes however many passes the checker takes", async () => {
  using dir = tempDir("aot-passes-change-no-test-run", testedProject());
  const programs: Record<number, string[]> = {};
  for (const passes of [1, 2, 3]) {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: `TestRunLayers:2,TestRunCheckerPasses:${passes}`,
      [buildEnvironment.logsPhaseTimes]: "1",
    });
    expect(exitCode).toBe(0);
    // There every test file has a program of its own, with all that it imports.
    if (stderr.includes("this Bun loads one program a realm")) return;
    // Each builder says the size and a hash of what it has built.
    programs[passes] = (stdout + stderr)
      .split("\n")
      .filter(line => line.startsWith("AOT part build | the program | "))
      .sort();
  }
  expect(programs[1].length).toBeGreaterThanOrEqual(3);
  expect(programs[2]).toEqual(programs[1]);
  expect(programs[3]).toEqual(programs[1]);
}, 240_000);
