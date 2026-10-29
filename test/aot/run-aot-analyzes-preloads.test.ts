import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// What --preload names runs in the same process as the program, so `bun run --aot` and `bun test --aot` look at it as they look at the program.
const settings = {
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true } }`,
};
const log = `declare const console: { log(...values: unknown[]): void };\n`;

async function ran(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("run-aot-analyzes-preloads", { ...settings, ...files });
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], String(dir));
  return { stdout, stderr, exitCode };
}

test("a type error in a preload ends bun run --aot before a line runs", async () => {
  const files = {
    "pre.ts": log + `console.log("the preload ran"); const port: number = "8080"; console.log(port);`,
    "main.ts": log + `console.log("the program ran");`,
  };
  const { stdout, stderr, exitCode } = await ran(files, "run", "--aot", "--preload", "./pre.ts", "main.ts");
  expect(stderr).toContain("TS2322");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

test("and bun test --aot", async () => {
  const files = {
    "pre.ts": log + `console.log("the preload ran"); const port: number = "8080"; console.log(port);`,
    "main.test.ts":
      `import { test } from "bun:test";\n` + log + `test("case", () => { console.log("the test ran"); });`,
  };
  const { stdout, stderr, exitCode } = await ran(files, "test", "--aot", "--preload", "./pre.ts", "./main.test.ts");
  expect(stderr).toContain("TS2322");
  expect(stdout).not.toContain("ran");
  expect(exitCode).toBe(1);
});

test("a preload without errors runs first, and a value in it that does not fit its type gives what plain Bun gives", async () => {
  const files = {
    "pre.ts":
      log +
      `function double(n: number): number { return n * 2; } const given: any = JSON.parse('"4"'); try { console.log(double(given)); } catch (e) { console.log(String(e)); }`,
    "main.ts": log + `console.log("the program ran");`,
  };
  const plain = await ran(files, "run", "--preload", "./pre.ts", "main.ts");
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "8\nthe program ran\n", exitCode: 0 });
  const { stdout, exitCode } = await ran(files, "run", "--aot", "--preload", "./pre.ts", "main.ts");
  expect({ stdout, exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});

test("a preload that is not there ends the run as it ends plain Bun's, with an error that names it", async () => {
  const files = { "main.ts": log + `console.log("the program ran");` };
  const plain = await ran(files, "run", "--preload", "./none.ts", "main.ts");
  const held = await ran(files, "run", "--aot", "--preload", "./none.ts", "main.ts");
  expect({ stdout: held.stdout, exitCode: held.exitCode }).toEqual({ stdout: plain.stdout, exitCode: plain.exitCode });
  expect(held.stderr).toContain(`"./none.ts" was not found`);
});
