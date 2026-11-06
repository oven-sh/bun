import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      noEmit: true,
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types", "bun-types/test-globals"],
    },
  }),
  "shared.ts": `export const one: number = 1;`,
  "broken.ts": `export const two: number = "two";`,
  "a-fine.test.ts": `import { one } from "./shared"; test("a fine test", () => { expect(one).toBe(1); });`,
  "b-wrong.test.ts": `export {}; const n: number = "text"; test("never run, its own error", () => { expect(n).toBe(1); });`,
  "c-imports-wrong.test.ts": `import { two } from "./broken"; test("never run, an imported error", () => { expect(two).toBe(2); });`,
  "d-fine.test.ts": `export {}; function double(n: number): number { return n * 2; } test("another fine test", () => { expect(double(2)).toBe(4); });`,
};

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const ran = (said: string) => [...said.matchAll(/^\((?:pass|fail)\) .*$/gm)].map(match => match[0]);
/** `error: TS2322: ..` and under it `    at <path>:<line>:<column>` */
const errors = (said: string) =>
  [...said.matchAll(/^error: (TS\d+): .*\n +at .*[\\/]([^\\/\n]+)$/gm)].map(match => `${match[2]} ${match[1]}`).sort();

async function run(dir: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "test", "--aot", ...args], dir);
  return { said: stdout + stderr, exitCode };
}

// `bun test --aot` asks the compiler about every test file before the first test runs. A file that a build refuses fails without being run, and the others run.
test("a type error fails the test files that reach it, and the others run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir));
  expect(errors(said)).toEqual(["b-wrong.test.ts:1:18 TS2322", "broken.ts:1:14 TS2322"]);
  expect(said).toContain("(pass) a fine test");
  expect(said).toContain("(pass) another fine test");
  expect(ran(said).join("\n")).not.toContain("never run");
  expect(said.split("bun test --aot does not run this file").length - 1).toBe(2);
  expect(said).toMatch(/\b2 pass\b/);
  expect(said).toMatch(/\b2 fail\b/);
  expect(said).toContain("Ran 4 tests across 4 files");
  expect(said.split("TS2322").length - 1).toBe(2);
  expect(exitCode).toBe(1);
});

test("--bail counts such a file", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir), "--bail");
  expect(said).toContain("Bailed out after 1 failure");
  expect(said.split("bun test --aot does not run this file").length - 1).toBe(1);
  expect(exitCode).toBe(1);
});

test("where every test file reaches an error nothing is run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir), "b-wrong", "c-imports-wrong");
  expect(errors(said)).toEqual(["b-wrong.test.ts:1:18 TS2322", "broken.ts:1:14 TS2322"]);
  expect(ran(said)).toEqual([]);
  expect(exitCode).toBe(1);
});

test("an error in a preload stops the run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir), "--preload", "./broken.ts", "a-fine", "d-fine");
  expect(errors(said)).toEqual(["broken.ts:1:14 TS2322"]);
  expect(ran(said)).toEqual([]);
  expect(exitCode).toBe(1);
});

test("what only a refused test file imports is still declared for the others", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", {
    "tsconfig.json": files["tsconfig.json"],
    "global.ts": `export {}; declare global { var added: number | undefined; interface Settings { depth?: number } }`,
    "shape.ts": `export interface Shape { side: number }\nexport const square: Shape = { side: 2 };`,
    "wider.ts": `declare module "./shape" { interface Shape { label?: string } }\nexport {};`,
    "1-wrong.test.ts": `import "./global"; import "./wider"; const n: number = "text"; test("never run", () => { expect(n).toBe(1); });`,
    "2-global.test.ts": `export {}; test("a global variable", () => { expect(typeof added).toBe("undefined"); });`,
    "3-interface.test.ts": `export {}; const settings: Settings = {}; test("a global interface", () => { expect(settings.depth).toBeUndefined(); });`,
    "4-module.test.ts": `import { square } from "./shape"; test("a member added to a module's interface", () => { expect(square.label).toBeUndefined(); });`,
  });
  const { said, exitCode } = await run(String(dir));
  expect(errors(said)).toEqual(["1-wrong.test.ts:1:44 TS2322"]);
  expect(passed(said)).toEqual(["a global interface", "a global variable", "a member added to a module's interface"]);
  expect(said.split("bun test --aot does not run this file").length - 1).toBe(1);
  expect(exitCode).toBe(1);
});

test("refusing one test file after another does not refuse a third", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", {
    "tsconfig.json": files["tsconfig.json"],
    "first.ts": `export {}; declare global { var first: number | undefined; }`,
    "second.ts": `export {}; declare global { var second: number | undefined; }`,
    "1-wrong.test.ts": `import "./first"; const n: number = "text"; test("never run", () => { expect(n).toBe(1); });`,
    "2-uses-first.test.ts": `import "./second"; test("uses the first", () => { expect(typeof first).toBe("undefined"); });`,
    "3-uses-second.test.ts": `export {}; test("uses the second", () => { expect(typeof second).toBe("undefined"); });`,
  });
  const { said } = await run(String(dir));
  expect(errors(said)).toEqual(["1-wrong.test.ts:1:25 TS2322"]);
  expect(passed(said)).toEqual(["uses the first", "uses the second"]);
});

test("a syntax error fails the test files that reach it, and the others run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", {
    "tsconfig.json": files["tsconfig.json"],
    "broken.ts": `export const two = ;\n`,
    "a-fine.test.ts": `test("a fine test", () => { expect(1).toBe(1); });`,
    "b-wrong.test.ts": `export const n = ;\ntest("never run, its own error", () => { expect(1).toBe(1); });`,
    "c-imports-wrong.test.ts": `import { two } from "./broken"; test("never run, an imported error", () => { expect(two).toBe(2); });`,
    "d-fine.test.ts": `test("another fine test", () => { expect(2).toBe(2); });`,
  });
  const { said, exitCode } = await run(String(dir));
  expect(passed(said)).toEqual(["a fine test", "another fine test"]);
  expect(ran(said).join("\n")).not.toContain("never run");
  expect(said.split("bun test --aot does not run this file").length - 1).toBe(2);
  expect(exitCode).toBe(1);
});
