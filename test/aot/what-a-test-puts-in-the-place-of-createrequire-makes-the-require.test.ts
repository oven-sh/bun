import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `spyOn(Module, "createRequire").mockImplementation(() => name => ..)`, and then `Module.createRequire(import.meta.url)("./next.mjs")`.
// The build read the second line as a load of ./next.mjs: it called the spy, dropped what the spy made and loaded the file.
// `import { createRequire } from "node:module"` holds what the module exported when it was linked, and goes on making requires.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/next.mjs": `console.log("the next file runs"); export const name = "next";
`,
  "src/other.cjs": `console.log("the other file runs"); exports.name = "other";
`,
  "src/loads.mjs": `import M, { createRequire } from "node:module";
export const byMember = () => M.createRequire(import.meta.url)("./other.cjs");
export const byName = () => createRequire(import.meta.url)("./other.cjs");
`,
  "a.test.js": `import { test, spyOn } from "bun:test";
import M from "node:module";
import * as loads from "./src/loads.mjs";
const say = (name, run) => { try { const answer = run(); console.log(name, typeof answer === "string" ? answer : answer.name); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("createRequire is assigned", () => {
  const real = M.createRequire;
  say("before", () => M.createRequire(import.meta.url)("./src/next.mjs"));
  M.createRequire = () => name => "mine " + name;
  say("assigned", () => M.createRequire(import.meta.url)("./src/next.mjs"));
  say("assigned, in a file of the project, by the member", () => loads.byMember());
  say("assigned, in a file of the project, by the imported name", () => loads.byName());
  M.createRequire = real;
  say("put back", () => M.createRequire(import.meta.url)("./src/next.mjs"));
});
`,
  "b.test.js": `import { test, spyOn } from "bun:test";
import M from "node:module";
const say = (name, run) => { try { const answer = run(); console.log(name, typeof answer === "string" ? answer : answer.name); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("a spy on createRequire", () => {
  const spy = spyOn(M, "createRequire").mockImplementation(() => name => "the spy's " + name);
  say("spied", () => M.createRequire(import.meta.url)("./src/next.mjs"));
  console.log("calls", spy.mock.calls.length);
  spy.mockRestore();
  say("restored", () => M.createRequire(import.meta.url)("./src/next.mjs"));
});
`,
  "c.test.cjs": `const { test } = require("bun:test");
const say = (name, run) => { try { const answer = run(); console.log(name, typeof answer === "string" ? answer : answer.name); } catch (error) { console.log(name, "throws", error.message.slice(0, 60)); } };
test("createRequire is defined", () => {
  const real = require("node:module").createRequire;
  Object.defineProperty(require("node:module"), "createRequire", { value: () => name => "mine " + name, configurable: true, writable: true });
  say("defined", () => require("node:module").createRequire(__filename)("./src/other.cjs"));
  const load = require("node:module").createRequire(__filename);
  say("held in a variable", () => load("./src/other.cjs"));
  require("node:module").createRequire = real;
  say("put back", () => require("node:module").createRequire(__filename)("./src/other.cjs"));
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test(`what a test puts in the place of createRequire makes the require, ${way}`, async () => {
    using dir = tempDir("aot-createrequire-replaced-by-a-test", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("assigned mine ./src/next.mjs");
    expect(plain.stdout).toContain("spied the spy's ./src/next.mjs");
    expect(plain.stdout).toContain("held in a variable mine ./src/other.cjs");
    expect(plain.stdout).toContain("assigned, in a file of the project, by the imported name other");
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
