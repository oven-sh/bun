import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` in layers: the packages are one program, the files of the project a second above it. A build takes memory by the
// size of its program, and a project can be much larger than its packages. `TestRunLayers:3` and more cut the files of the project
// into programs that stand one above the other. No program imports from one above it: a file goes down when all that it imports has
// gone, and files that import one another in a circle go together. Where a file is built changes nothing that a test sees.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "bunfig.toml": `[test]\npreload = ["./preload.ts"]`,
  "node_modules/counter/package.json": `{ "name": "counter", "version": "1.0.0", "main": "./index.js", "type": "module" }`,
  "node_modules/counter/index.js": `const ran = (globalThis.ran ??= []);\nran.push("counter");\nlet count = 0;\nexport const next = () => ++count;`,
  "preload.ts": `import { double } from "./src/alone";\n(globalThis as any).fromPreload = double(21);`,
  "src/leaf.ts": `import { next } from "counter";
    globalThis.ran.push("leaf");
    export class Leaf { #id: number = next(); get id() { return this.id_(); } id_() { return this.#id; } static is(value: object) { return #id in value; } }
    export const first = new Leaf();
    // The name is not in the text: the file may be in a program above.
    export const load = (name: string) => import(name);`,
  // An import of types loads nothing: it closes no circle with what imports this file.
  "src/alone.ts": `import type { Top } from "./top";
    import { type Middle } from "./middle";
    (globalThis.ran ??= []).push("alone");
    export const double = (value: number) => value * 2;
    export const nameOf = (value: Top | Middle) => value.name;`,
  "src/common.cjs": `(globalThis.ran ??= []).push("common");\nlet calls = 0;\nexports.called = () => ++calls;`,
  "src/middle.ts": `import { Leaf, first } from "./leaf";
    import { double } from "./alone";
    globalThis.ran.push("middle");
    export const make = () => new Leaf();
    export const twice = () => double(first.id);
    export const called = () => require("./common.cjs").called();
    export class Middle extends Leaf { name = "middle"; }`,
  "src/circle-a.ts": `import { b } from "./circle-b";\nglobalThis.ran.push("circle-a");\nexport const a = () => "a";\nexport const both = () => a() + b();`,
  "src/circle-b.ts": `import { a } from "./circle-a";\nglobalThis.ran.push("circle-b");\nexport const b = () => "b";\nexport const back = () => b() + a();`,
  "src/late.ts": `globalThis.ran.push("late");\nexport const late = async () => (await import("./top")).all().length;`,
  "src/top.ts": `import { make, twice, called, Middle } from "./middle";
    import { both } from "./circle-a";
    import { back } from "./circle-b";
    import { Leaf } from "./leaf";
    globalThis.ran.push("top");
    export class Top extends Middle { top = true; }
    export const all = () => [make().id, twice(), called(), both(), back(), Leaf.is(new Top()), new Top() instanceof Leaf, new Top().name];`,
  "top.test.ts": `import { test } from "bun:test";
    import { join } from "node:path";
    import { all, Top } from "./src/top";
    import { Leaf, first, load } from "./src/leaf";
    import { late } from "./src/late";
    import { next } from "counter";
    test("through all of them", async () => {
      console.log("all", ...all(), first instanceof Leaf, first.id, next(), (globalThis as any).fromPreload, await late());
      const loaded = await load(join(import.meta.dir, "src", "top.ts"));
      console.log("loaded", loaded.Top === Top, loaded.all().length, globalThis.ran.join());
    });`,
  "mocked.test.ts": `import { test, mock, spyOn } from "bun:test";
    import * as circle from "./src/circle-a";
    mock.module("./src/alone", () => ({ double: (value: number) => value * 10 }));
    test("a file that went down is replaced", async () => {
      const { twice } = await import("./src/middle");
      console.log("mocked", twice());
    });
    test("an export of a file that went down is spied on", async () => {
      const spy = spyOn(circle, "a").mockReturnValue("A");
      const { back } = await import("./src/circle-b");
      console.log("spied", back(), circle.both(), spy.mock.calls.length);
      spy.mockRestore();
      console.log("restored", back());
    });`,
  "thrown.test.ts": `import { test } from "bun:test";
    import { twice } from "./src/middle";
    import * as leaf from "./src/leaf";
    test("an error crosses the programs", () => {
      const id_ = leaf.Leaf.prototype.id_;
      leaf.Leaf.prototype.id_ = function () { throw new RangeError("no id"); };
      try { twice(); } catch (error) { console.log("thrown", error instanceof RangeError, (error as Error).stack!.split("\\n").filter(line => line.includes("/src/")).map(line => line.replace(/^.*\\/src\\//, "").replace(/\\)$/, "")).join()); }
      leaf.Leaf.prototype.id_ = id_;
      console.log("again", twice());
    });`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr.slice(-4000));
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  const went = [...stderr.matchAll(/the lowest files are found: (\d+) of (\d+) files/g)].map(match => [
    +match[1],
    +match[2],
  ]);
  const circles = [...stderr.matchAll(/the largest circle has (\d+) files/g)].map(match => +match[1]);
  return { went, circles, seen: { stdout: printed.sort(), results: results.sort(), exitCode } };
}

test("a test sees the same wherever the files of the project are built", async () => {
  using dir = tempDir("aot-the-files-of-a-project-in-programs", files);
  const plain = await runTests(String(dir), "");
  expect(plain.seen.results.length).toBe(4);
  expect(plain.seen.exitCode).toBe(0);
  expect(plain.seen.stdout).toContain("mocked 10");
  expect(plain.seen.stdout).toContain("spied bA Ab 2");

  const [two, none, half, all, four] = await Promise.all([
    runTests(String(dir), "TestRunLayers:2", "--aot"),
    runTests(String(dir), "TestRunLayers:3,TestRunLowestPercent:0", "--aot"),
    runTests(String(dir), "TestRunLayers:3", "--aot"),
    runTests(String(dir), "TestRunLayers:3,TestRunLowestPercent:100", "--aot"),
    runTests(String(dir), "TestRunLayers:4", "--aot"),
  ]);
  expect(two).toEqual({ went: [], circles: [], seen: plain.seen });
  expect(none).toEqual({ went: [[0, 8]], circles: [2], seen: plain.seen });
  expect(half.seen).toEqual(plain.seen);
  expect(half.went.length).toBe(1);
  expect(half.went[0][0]).toBeWithin(1, 8);
  // The two that import one another go together, and what imports them goes behind them.
  expect(all).toEqual({ went: [[8, 8]], circles: [2], seen: plain.seen });
  expect(four.seen).toEqual(plain.seen);
  // The second of them looks at what the first has left.
  expect(four.went.length).toBe(2);
  expect(four.went[1][1]).toBe(8 - four.went[0][0]);
}, 240_000);
