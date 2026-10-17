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
