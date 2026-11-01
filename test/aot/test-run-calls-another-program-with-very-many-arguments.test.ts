import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Where a run is built as several programs, a call from one into another says which program runs and puts the caller's back when
// it returns. Above 4,096 arguments the frame that does so is moved, and it has to be found again where it lies then.
test("a call into another program of the run with more than 4,096 arguments leaves the caller as it was", async () => {
  const fillers = Array.from({ length: 16 }, (_, index) => `t${String(index).padStart(2, "0")}`);
  using dir = tempDir("aot-test-run-very-many-arguments", {
    "tsconfig.json": "{}",
    "node_modules/takes/package.json": JSON.stringify({
      name: "takes",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/takes/index.js": `
export function count(...all) { return all.length; }
export function lastOf(first) { return arguments[arguments.length - 1] + arguments.length; }
export function callWith(f, n) { const list = []; for (let i = 0; i < n; i++) list.push(i); return f(...list); }
export class Made { constructor(...all) { this.count = all.length; } }
export function throws(...all) { throw new RangeError("got " + all.length); }
export function* yields(...all) { yield all.length; yield all[all.length - 1]; }
export async function awaits(...all) { await null; return all.length; }
export function one() { return 1; }
`,
    "lib.ts": `
import { count } from "takes";
export function countHere(...all: number[]): number { return all.length; }
export function callWithHere(f: (...all: number[]) => number, n: number): number { const list: number[] = []; for (let i = 0; i < n; i++) list.push(i); return f(...list); }
export function countThere(n: number): number { return callWithHere(count, n); }
`,
    "many.test.ts": `
import { test } from "bun:test";
import * as takes from "takes";
import * as lib from "./lib";
const list = (n: number) => Array.from({ length: n }, (_, i) => i);
class Local { #secret = 7; constructor(readonly tag: string) {} read() { return this.tag + this.#secret; } }
// What goes by the tables of the program that runs.
function stillHere(label: string) {
  const o = { a: 1, b: "two", c: [3] }, text = label + o.a + o.b + o.c[0];
  const named = (new Error("e").stack ?? "").split("\\n")[1]?.includes("stillHere");
  console.log("|", text, /(\\d+)two/.exec(text)?.[1], new Local(label).read(), JSON.stringify({ ...o, d: label.length }), named, takes.one(), lib.countHere(1, 2));
}
for (const n of [4096, 4097, 20000]) {
  test("with " + n, async () => {
    console.log("|", n, takes.count(...list(n))); stillHere("spread");
    console.log("|", n, lib.countHere(...list(n))); stillHere("spread into the project's file");
    console.log("|", n, takes.count.apply(null, list(n))); stillHere("apply");
    console.log("|", n, Reflect.apply(takes.lastOf, null, list(n))); stillHere("Reflect.apply");
    console.log("|", n, takes.callWith((...all: number[]) => all.length, n)); stillHere("called back");
    console.log("|", n, lib.countThere(n)); stillHere("between the two below");
    console.log("|", n, new takes.Made(...list(n)).count, Reflect.construct(takes.Made, list(n)).count); stillHere("new");
    try { takes.throws(...list(n)); } catch (error) { console.log("|", (error as Error).message); } stillHere("a throw");
    try { takes.callWith((...all: number[]) => { throw new Error("threw with " + all.length); }, n); } catch (error) { console.log("|", (error as Error).message); } stillHere("a throw back");
    console.log("|", n, JSON.stringify([...takes.yields(...list(n))])); stillHere("a generator");
    console.log("|", n, await takes.awaits(...list(n))); stillHere("an async function");
  });
}
`,
    ...Object.fromEntries(
      fillers.map(name => [
        `${name}.test.ts`,
        `import { test } from "bun:test";\nimport { countHere } from "./lib";\ntest("${name}", () => { console.log("|", "${name}", countHere(1)); });\n`,
      ]),
    ),
  });
  async function report(words: string, ...flags: string[]) {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=2", ...flags],
      String(dir),
      env,
    );
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
    return { lines: lines.sort(), ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0], exitCode };
  }
  const plain = await report("");
  expect(plain.ran).toBe("Ran 19 tests across 17 files");
  expect(plain.lines.length).toBe(16 + 3 * 22);
  expect(plain.exitCode).toBe(0);
  // So small a project is one program unless it is told otherwise.
  expect(await report("TestRunLayers:1", "--aot")).toEqual(plain);
  expect(await report("TestRunLayers:2", "--aot")).toEqual(plain);
});
