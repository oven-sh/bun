import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const files = {
  "package.json": `{ "name": "objects-that-gain-a-name", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" } }`,
  "src/lower.ts": `
    export type Point = { x: number; y: number; label: string };
    export function make(x: number): Point { return { x, y: x + 1, label: "p" + x }; }`,
  "src/upper.ts": `
    import type { Point } from "./lower";
    export function own(x: number): Point { return { x, y: -1, label: "own" }; }
    export function read(p: Point): string { return String((p as any).gained); }
    export function has(p: Point): string { return String(Object.hasOwn(p, "gained")); }
    export function isIn(p: Point): string { return String("gained" in p); }
    export function storeThenRead(p: Point, value: number): string { (p as any).gained = value; return String((p as any).gained); }`,
  "objects.test.ts": `
    import { test } from "bun:test";
    import * as lower from "./src/lower";
    import * as upper from "./src/upper";
    test("gained", () => {
      for (const make of [upper.own, lower.make]) {
        let p: any = make(1); p.gained = "there";
        console.log("SAID gained above", upper.read(p), upper.has(p), upper.isIn(p), Object.keys(p).join());
        p = make(1);
        console.log("SAID not yet", upper.read(p), upper.has(p), upper.isIn(p));
        console.log("SAID stored between", upper.storeThenRead(p, 3), upper.read(p), upper.has(p), upper.isIn(p), JSON.stringify(p));
        delete p.gained;
        console.log("SAID removed", upper.read(p), upper.has(p), upper.isIn(p), JSON.stringify(p));
      }
    });`,
};

async function runIn(words: string | undefined, ...flags: string[]) {
  using dir = tempDir("aot-objects-that-gain-a-name", files);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
  return { said: stdout.split("\n").filter(line => line.startsWith("SAID")), exitCode };
}

test("a name that the layer between stores on its own objects too is read off an object from below", async () => {
  const [plain, one, two, three] = await Promise.all([
    runIn(undefined),
    runIn("TestRunLayers:0", "--aot"),
    runIn("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
    runIn("TestRunLayers:3,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain).toEqual({ said: plain.said, exitCode: 0 });
  expect(plain.said.length).toBe(8);
  expect(one).toEqual(plain);
  expect(two).toEqual(plain);
  expect(three).toEqual(plain);
});
