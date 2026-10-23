import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  types: [] as string[],
  strict: true,
  outDir: "./dist",
};

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) => [...new Set([...said.matchAll(/\berror:? (TS\d+)/g)].map(match => match[1]))].sort();

const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDir: "./src" }, include: ["./src/**/*.ts"] }),
  "src/one.ts": `export const one: number = 1;\n`,
  "src/one.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "./one";\ntest("beside the source", () => {\n  expect(one).toBe(1);\n});\n`,
  "test/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDir: "." }, include: ["."] }),
  "test/one.test.ts": `import { expect, test } from "bun:test";\nimport { one } from "../src/one";\ndeclare global {\n  var marker: number | undefined;\n}\ntest("outside rootDir", () => {\n  expect(one).toBe(1);\n  expect(globalThis.marker).toBeUndefined();\n});\n`,
};

test("rootDir says where tsc writes its output: a file outside it is no error under --aot, alone or beside others", async () => {
  using dir = tempDir("root-dir-has-no-say", files);
  const alone = await run(String(dir), "test", "--aot", "./test/one.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(passed(alone.said)).toEqual(["outside rootDir"]);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(passed(together.said)).toEqual(["beside the source", "outside rootDir"]);
}, 60_000);

test("a file of the project outside rootDir does not keep the rest from being type checked", async () => {
  using dir = tempDir("root-dir-has-no-say", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDir: "./src" }, include: ["src", "test"] }),
    "src/wrong.ts": `export const wrong: number = "text";\n`,
    "src/main.ts": `import { wrong } from "./wrong";\nexport const main = wrong;\n`,
    "test/setup.ts": `declare global {\n  var marker: number | undefined;\n}\nexport {};\n`,
  });
  const { said, exitCode } = await run(String(dir), "check", "--aot", "src/main.ts");
  expect(errors(said)).toEqual(["TS2322"]);
  expect(said).not.toContain("Stopped before type checking");
  expect(exitCode).toBe(1);
});

test("bun check without --aot reports it as tsc does", async () => {
  using dir = tempDir("root-dir-has-no-say", files);
  const { said, exitCode } = await run(String(dir), "check", "-p", "test");
  expect(errors(said)).toContain("TS6059");
  expect(exitCode).toBe(1);
});
