import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": [] } }`,
  "shared.ts": `export const one: number = 1;`,
  "broken.ts": `export const two: number = "two";`,
  "a-fine.test.ts": `import { one } from "./shared"; test("a fine test", () => { expect(one).toBe(1); });`,
  "b-wrong.test.ts": `export {}; const n: number = "text"; test("never run, its own error", () => { expect(n).toBe(1); });`,
  "c-imports-wrong.test.ts": `import { two } from "./broken"; test("never run, an imported error", () => { expect(two).toBe(2); });`,
  "d-fine.test.ts": `export {}; function double(n: number): number { return n * 2; } const untyped: any = double; test("the rules hold in the others", () => { expect(() => untyped("x")).toThrow(TypeError); });`,
};

async function run(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "test", "--aot", ...args], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

// A build stops at a type error. A run of tests fails the files that cannot be built and runs the others.
test("a type error fails the test files that reach it, and the others run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir));
  expect(said).toContain("b-wrong.test.ts(1,18): error TS2322");
  expect(said).toContain("broken.ts(1,14): error TS2322");
  expect(said).toContain("(pass) a fine test");
  expect(said).toContain("(pass) the rules hold in the others");
  expect(said).not.toContain("never run");
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
  expect(said).toContain("error TS2322");
  expect(said).not.toContain("never run");
  expect(said).not.toContain("does not run this file");
  expect(exitCode).toBe(1);
});

test("an error in a preload stops the run", async () => {
  using dir = tempDir("run-aot-fails-file-with-type-error", files);
  const { said, exitCode } = await run(String(dir), "--preload", "./broken.ts", "a-fine", "d-fine");
  expect(said).toContain("broken.ts(1,14): error TS2322");
  expect(said).not.toContain("(pass)");
  expect(exitCode).toBe(1);
});

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) => [...said.matchAll(/^(\S+)\(\d+,\d+\): error (TS\d+)/gm)].map(match => `${match[1]} ${match[2]}`).sort();

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
  expect(errors(said)).toEqual(["1-wrong.test.ts TS2322"]);
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
  expect(errors(said)).toEqual(["1-wrong.test.ts TS2322"]);
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
  expect(said).not.toContain("never run");
  expect(said.split("bun test --aot does not run this file").length - 1).toBe(2);
  expect(exitCode).toBe(1);
});
