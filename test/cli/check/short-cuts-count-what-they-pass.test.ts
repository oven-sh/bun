import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

// A walk back from a reference skips to a dominator, and leaps over the antecedents of a label that lie below one dominator, where nothing between concerns the reference.
// TypeScript passes every node, and a walk that nests 2,000 calls reports TS2563. So each short cut adds what it passes to the depth of the walk: the longest row of calls
// between the two nodes and, on top, the longest turn of a loop between them. A walk that gets too deep that way is walked again without the short cuts.
//
// With each form, the lowest count at which the walk without the short cuts reports TS2563. With the short cuts taken and nothing counted, the first begins one later and
// the other three never.
const head = "export {};\ndeclare function g(): void;\ndeclare const m: number;\n";
const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => row(index)).join("");
const loop = "    for (let i = 0; i < m; i++) x += i;\n";
const forms: [name: string, limit: number, write: (count: number) => string][] = [
  [
    "tests of another name behind a narrowing",
    1000,
    count =>
      `${head}function f(a: string | number, y: string | number) {\n  if (typeof y === "number") return 0;\n` +
      `${rows(count, () => `  if (typeof a === "string") { g(); }\n`)}  return y.length;\n}\n`,
  ],
  [
    "a test in the middle of loops in a row inside one loop",
    1998,
    count =>
      `${head}function f(y: string | number) {\n  let x = 0;\n  for (let r = 0; r < m; r++) {\n${rows(count >> 1, () => loop)}` +
      `    if (typeof y === "string") x += y.length;\n${rows(count - (count >> 1), () => loop)}    y = m ? 1 : "a";\n  }\n  return x;\n}\n`,
  ],
  [
    "try statements in a row behind a narrowing",
    1999,
    count =>
      `${head}function f(y: string | number) {\n  let x = 0;\n  if (typeof y === "number") return 0;\n` +
      `${rows(count, index => `  try { g(); x = ${index}; } catch { x = -1; }\n`)}  return y.length + x;\n}\n`,
  ],
  [
    "names stored in loops in a row under a try and read behind it",
    1999,
    count =>
      `${head}function f() {\n  let s = 0${rows(count, index => `, x${index}: string | number = 0`)};\n  try {\n` +
      `${rows(count, index => `    for (let i = 0; i < m; i++) x${index} = m ? "a" : i;\n`)}  } catch { s = -1; }\n  return [s${rows(count, index => `, x${index}`)}];\n}\n`,
  ],
];

// A debug build can run out of stack before it reaches the limit.
test.skipIf(isDebug || isASAN).each(forms)(
  "TS2563 begins where it does without the short cuts: %s",
  async (_, limit, write) => {
    using dir = tempDir("check-short-cuts-count-what-they-pass", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, types: [] },
        include: ["*.ts"],
      }),
      "below.ts": write(limit - 1),
      "at.ts": write(limit),
    });
    await using proc = spawn({
      cmd: [bunExe(), "check", "--no-pretty", "--threads=1"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    expect((stdout + stderr).split("\n").filter(line => line.includes("error TS"))).toEqual([
      expect.stringMatching(/^at\.ts\(\d+,\d+\): error TS2563: /),
    ]);
  },
  longLimit,
);
