import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A spy or a mock that the build did not see is refused. The error says what is true of the run, names the module, and says what to do.
const page = "(https://bun.com/docs/compiler/debugging#run-your-tests-compiled)";
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
const reports = `console.log("SAID " + name + ": no error"); } catch (error) { console.log("SAID " + name + ": " + error.name + ": " + error.message); }`;

test("in a test run", async () => {
  // The code comes out of files that no build reads as code.
  using dir = tempDir("aot-refused-spies-and-mocks", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/lib.js": `export function answer() { return "real"; }`,
    "spy.txt": `import { spyOn } from "bun:test"; import * as lib from "PATH"; spyOn(lib, "answer");`,
    "mock.txt": `Bun.jest(globalThis.here).mock.module("PATH", () => ({ answer: () => "mocked" }))`,
    "a.test.js": `import { test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer } from "./src/lib.js";
globalThis.here = import.meta.path;
const path = JSON.stringify(join(import.meta.dir, "src", "lib.js")).slice(1, -1);
for (const name of ["spy", "mock"])
  test(name, async () => {
    try {
      const text = readFileSync(join(import.meta.dir, name + ".txt"), "utf8").replace("PATH", path);
      const file = join(mkdtempSync(join(tmpdir(), "written-")), "late.mjs");
      writeFileSync(file, text);
      await import(file);
      void answer;
      ${reports}
  });`,
  });
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect(said(plain.stdout + "\n" + plain.stderr)).toEqual(["SAID spy: no error", "SAID mock: no error"]);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  const lib = join(String(dir), "src", "lib.js");
  // The file that spies and mocks was written while the tests ran, under a name of the run.
  const lines = said(compiled.stdout + "\n" + compiled.stderr).map(line =>
    line.replace(/"[^"]*late\.mjs"/, `"late.mjs"`),
  );
  const notCompiled = `wasn't compiled with your tests: the build couldn't follow the path that loads it. Import that file by a constant path, or put its path together from import.meta.dir: import(import.meta.dir + "/folder/" + name) ${page}`;
  expect(lines).toEqual([
    `SAID spy: TypeError: Cannot spy on 'answer' of "${lib}" because "late.mjs", which makes the spy, ${notCompiled}`,
    `SAID mock: TypeError: mock(module, fn) cannot replace "${lib}" because "late.mjs", which makes the mock, ${notCompiled}`,
  ]);
}, 600000);

test("through a re-export under another name, on the file that a factory returned", async () => {
  // The build follows the name that the spy is made under to the file that the mock names. The factory returns another file, and no spy names `answer`.
  using dir = tempDir("aot-refused-spies-and-mocks", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "dep.js": `export function answer() { return "real"; }`,
    "fake.js": `export function answer() { return "fake"; }`,
    "barrel.js": `export { answer as reply } from "./dep.js";`,
    "a.test.js": `import { mock, spyOn, test } from "bun:test";
mock.module("./dep.js", () => import("./fake.js"));
const barrel = await import("./barrel.js");
const name = "spy";
test(name, () => {
  try {
    spyOn(barrel, "reply");
    ${reports}
});`,
  });
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect({ said: said(plain.stdout + "\n" + plain.stderr), exitCode: plain.exitCode }).toEqual({
    said: ["SAID spy: no error"],
    exitCode: 0,
  });
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  const fake = join(String(dir), "fake.js");
  expect({ said: said(compiled.stdout + "\n" + compiled.stderr), exitCode: compiled.exitCode }).toEqual({
    said: [
      `SAID spy: TypeError: Cannot spy on 'answer' of "${fake}" because the build didn't see a test spy on it. Spell out the module and the name where the spy is made: import * as module from "<path>"; spyOn(module, "answer") ${page}`,
    ],
    exitCode: 0,
  });
}, 600000);

test("on an export that is the namespace object of a mocked module", async () => {
  // No build has seen the file that hands the namespace object on, so the spy is on a namespace object of the loader.
  using dir = tempDir("aot-refused-spies-and-mocks", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "dep.js": `export function answer() { return "real"; }`,
    "a.test.js": `import { mock, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
mock.module("./dep.js", () => ({ answer: () => "mocked" }));
const name = "spy";
test(name, async () => {
  const file = join(import.meta.dir, "late.mjs");
  writeFileSync(file, 'export * as dep from "./dep.js";');
  const late = await import(file);
  try {
    spyOn(late, "dep");
    ${reports}
});`,
  });
  const refused = {
    said: [
      "SAID spy: TypeError: Cannot spy on the `dep` export because it is the namespace object of a module that was loaded as a mock. Spy on an export of that module instead",
    ],
    exitCode: 0,
  };
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect({ said: said(plain.stdout + "\n" + plain.stderr), exitCode: plain.exitCode }).toEqual(refused);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect({ said: said(compiled.stdout + "\n" + compiled.stderr), exitCode: compiled.exitCode }).toEqual(refused);
}, 600000);

test("in an executable", async () => {
  using dir = tempDir("aot-refused-spies-and-mocks", {
    "lib.js": `export function answer() { return "real"; }`,
    "main.js": `import * as lib from "./lib.js";
const runner = Bun.jest(import.meta.path);
const ways = { spy: () => runner.spyOn(lib, "answer"), mock: () => runner.mock.module(import.meta.dir + "/lib.js", () => ({})) };
for (const name in ways) {
  try {
    ways[name]();
    ${reports}
}`,
  });
  const cmd = [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "main"];
  expect((await run(cmd, String(dir), bunEnv)).exitCode).toBe(0);
  const { stdout } = await run([join(String(dir), isWindows ? "main.exe" : "main")], String(dir), bunEnv);
  const words = said(stdout).map(line => line.replace(/"[^"]*lib\.js"/, `"lib.js"`));
  expect(words).toEqual([
    `SAID spy: TypeError: Cannot spy on 'answer' of "lib.js" because module exports can't be replaced in a compiled executable. Spy on it in a test, under bun test`,
    `SAID mock: TypeError: mock(module, fn) cannot replace "lib.js" because it was compiled ahead of time. Mock it in a test, under bun test`,
  ]);
}, 600000);
