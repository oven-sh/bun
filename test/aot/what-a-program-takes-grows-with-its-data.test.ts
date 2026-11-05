// run-parallel.ts: `// Sizes: <n> <4n> <16n>`, `// Passes: <n>` and `// Grows: linear`: what one piece of the data of a program costs must not hang on how much data there is.
// `// Grows: the build, linear`: the program writes programs, and what their builds take must grow as they do: that is counted, under --instructions alone.
// The programs of parallel/what-grows-with-its-data and parallel/what-a-build-takes-grows-with-its-program say those lines. Here the driver itself is held:
// it passes what is linear, it fails what is a square, and it passes over no line that it cannot read.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { basename, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const head = "// Sizes: 250 1000 4000\n// Passes: 40\n// Grows: linear\n";
const takesItsSize = "const size = Number(process.env.SIZE ?? 100), passes = Number(process.env.PASSES ?? 1);\n";
const runsItsPasses = "let told = 0;\nfor (let pass = 0; pass < passes; pass++) told = once();\nconsole.log(told);\n";
// Each element is weighed by 700 turns of its own: at the smallest size that is half of the work, so the square is not run for long.
const weighs =
  "function weigh(x) { let sum = 0; for (let i = 0; i < 700; i++) sum = (sum + (x ^ i)) | 0; return sum; }\n";
const linear =
  takesItsSize +
  weighs +
  "function once() { const list = []; let sum = 0; for (let i = 0; i < size; i++) { list.push(i); sum = (sum + weigh(i)) | 0; } return sum + list.length; }\n" +
  runsItsPasses;
// And besides, for each element, all that came before it is walked.
const square =
  takesItsSize +
  weighs +
  "function seek(list) { let at = -1; for (let i = 0; i < list.length; i++) if (list[i] === -1) at = i; return at; }\n" +
  "function once() { const list = []; let sum = 0; for (let i = 0; i < size; i++) { list.push(i); sum = (sum + weigh(i) + seek(list)) | 0; } return sum + list.length; }\n" +
  runsItsPasses;
const notRead =
  "read: not of the form `// Sizes: <n> <4n> <16n>`, `// Passes: <n>`, `// Grows: linear`, each once" +
  ", or three rising sizes and `// Grows: the build, linear` or `the build, a square`";
const headOfWriter = "// Sizes: 2 4 8\n// Passes: 3\n// Grows: the build, linear\n";
/** It prints a program with PASSES functions of so many statements each. */
const writer = (
  statements: string,
) => `const size = Number(process.env.SIZE ?? 2), copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push("function work" + copy + "(n) {", "  let x = n;");
  for (let at = 0; at < ${statements}; at++) out.push("  x = (x + " + (at & 7) + ") ^ n;");
  out.push("  return x;", "}");
}
out.push("let told = 0;");
for (let copy = 0; copy < copies; copy++) out.push("told = (told + work" + copy + "(2)) | 0;");
out.push("console.log(told);");
console.log(out.join("\\n"));
`;
const expected = {
  "linear.js": "pass",
  // With the address sanitizer nothing is asked of how a program grows.
  "a-square.js": isASAN ? "pass" : "growth: what it takes grows faster than its data",
  "sizes-that-are-not-four-times-the-one-before.js": notRead,
  "no-passes.js": notRead,
  "a-word-that-is-not-linear.js": notRead,
  "the-sizes-twice.js": notRead,
  "a-writer.js": "pass",
  "a-writer-that-stops-at-the-last-size.js": isASAN ? "pass" : "growth: it writes no program of the size 8",
  "a-word-on-the-build-that-is-not-read.js": notRead,
  "sizes-of-a-build-that-do-not-rise.js": notRead,
};

test("what a program takes may grow as its data grows, and no faster", async () => {
  using dir = tempDir("what-a-program-takes-grows-with-its-data", {
    "tsconfig.json": "{}",
    "linear.js": head + linear,
    "a-square.js": head + square,
    "sizes-that-are-not-four-times-the-one-before.js": head.replace("250 1000 4000", "250 500 1000") + linear,
    "no-passes.js": head.replace("// Passes: 40\n", "") + linear,
    "a-word-that-is-not-linear.js": head.replace("linear", "somehow") + linear,
    "the-sizes-twice.js": "// Sizes: 250 1000 4000\n" + head + linear,
    "a-writer.js": headOfWriter + writer("size"),
    "a-writer-that-stops-at-the-last-size.js":
      headOfWriter + 'if (process.env.SIZE === "8") process.exit(1);\n' + writer("size"),
    "a-word-on-the-build-that-is-not-read.js": headOfWriter.replace("linear", "somehow") + writer("size"),
    "sizes-of-a-build-that-do-not-rise.js": headOfWriter.replace("2 4 8", "2 8 4") + writer("size"),
  });
  const root = String(dir);
  const files = Object.keys(expected).map(name => join(root, name));
  const { stdout, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=4", "--no-erased", ...files],
    root,
    bunEnv,
  );
  const lines = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(({ state }) => state !== "compiling");
  const verdicts = Object.fromEntries(
    lines.map(({ file, state, stage, message }) => [
      file.slice(root.length + 1).replaceAll("\\", "/"),
      // What stands behind the colon are the numbers of this run.
      state === "pass" ? "pass" : `${stage}: ${stage === "growth" ? message.split(": ")[0] : message}`,
    ]),
  );
  expect(verdicts).toEqual(expected);
  expect(exitCode).toBe(1);
  // The line of a program that passes says how it grew: 4 is linear.
  if (!isASAN) expect(lines.find(({ file }) => basename(file) === "linear.js").growth).toBeWithin(2, 9.01);
}, 240_000);

// Where the processor's counters may be read. In a container they often may not.
const counts =
  !!Bun.which("perf") &&
  /^\d+,,instructions/m.test(
    Bun.spawnSync({ cmd: ["perf", "stat", "-x,", "-e", "instructions:u", "true"], stderr: "pipe" }).stderr.toString(),
  );

test.skipIf(!counts || isASAN)(
  "counted, a build may take more as its program grows, and no faster",
  async () => {
    const headOfLarger = "// Sizes: 10 20 40\n// Passes: 20\n// Grows: the build, linear\n";
    const expected = {
      "a-writer.js": "pass",
      "says-linear-and-writes-a-square.js": "growth: what the build takes grows faster than its program",
      "says-a-square-and-writes-one.js": "pass",
      "linear.js": "pass",
      "a-square.js": "growth: what it takes grows faster than its data",
    };
    using dir = tempDir("what-a-build-takes-grows-with-its-program", {
      "tsconfig.json": "{}",
      "a-writer.js": headOfLarger + writer("size * 10"),
      "says-linear-and-writes-a-square.js": headOfLarger + writer("size * size"),
      "says-a-square-and-writes-one.js": headOfLarger.replace("linear", "a square") + writer("size * size"),
      "linear.js": head + linear,
      "a-square.js": head + square,
    });
    const root = String(dir);
    const files = Object.keys(expected).map(name => join(root, name));
    const { stdout, exitCode } = await run(
      [
        bunExe(),
        join(import.meta.dir, "run-parallel.ts"),
        `--root=${root}`,
        "--jobs=4",
        "--no-erased",
        "--instructions",
        ...files,
      ],
      root,
      bunEnv,
    );
    const verdicts = Object.fromEntries(
      stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(({ state }) => state !== "compiling")
        .map(({ file, state, stage, message }) => [
          file.slice(root.length + 1).replaceAll("\\", "/"),
          state === "pass" ? "pass" : `${stage}: ${message.split(": ")[0]}`,
        ]),
    );
    expect(verdicts).toEqual(expected);
    expect(exitCode).toBe(1);
  },
  240_000,
);
