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
      if (name === "mock") (0, eval)(text);
      else {
        const file = join(mkdtempSync(join(tmpdir(), "written-")), "late.mjs");
        writeFileSync(file, text);
        await import(file);
      }
      void answer;
      ${reports}
  });`,
  });
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect(said(plain.stdout + "\n" + plain.stderr)).toEqual(["SAID spy: no error", "SAID mock: no error"]);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  const lib = join(String(dir), "src", "lib.js");
  expect(said(compiled.stdout + "\n" + compiled.stderr)).toEqual([
    `SAID spy: TypeError: Cannot spy on 'answer' of "${lib}" because the build didn't see a test spy on it. Spell out the module and the name where the spy is made: import * as module from "<path>"; spyOn(module, "answer") ${page}`,
    `SAID mock: TypeError: mock(module, fn) cannot replace "${lib}" because the build didn't see a test mock it. Spell out the module's path where the mock is made: mock.module("<path>", factory) ${page}`,
  ]);
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
