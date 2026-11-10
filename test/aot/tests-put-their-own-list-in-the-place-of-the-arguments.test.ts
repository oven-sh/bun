// Tests of a command line put a list of their own in the place of process.argv and put the old one back. Compiled code reads what is there at the time.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "arguments.test.js": `import { afterEach, beforeEach, expect, test } from "bun:test";
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function count() {
  return process.argv.length;
}
function third() {
  return process.argv[2];
}
let saved;
beforeEach(() => {
  saved = process.argv;
});
afterEach(() => {
  process.argv = saved;
});
test("as the run was started", () => {
  expect(Array.isArray(process.argv)).toBe(true);
  expect(hasFlag("--never-given")).toBe(false);
  expect(count()).toBeGreaterThan(1);
});
test("a list of texts in its place", () => {
  process.argv = ["bun", "cli", "--flag"];
  expect([hasFlag("--flag"), count(), third()]).toEqual([true, 3, "--flag"]);
});
test("put back", () => {
  expect(hasFlag("--flag")).toBe(false);
});
test("a list of other things in its place", () => {
  process.argv = [1, null, { a: 1 }];
  expect([hasFlag(1), count(), third()]).toEqual([true, 3, { a: 1 }]);
});
test("no list in its place", () => {
  process.argv = 5;
  expect([count(), third()]).toEqual([undefined, undefined]);
  expect(() => hasFlag("x")).toThrow(TypeError);
});
test("redefined", () => {
  const before = Object.getOwnPropertyDescriptor(process, "argv");
  Object.defineProperty(process, "argv", { get: () => ["only"], configurable: true });
  expect([count(), third(), hasFlag("only")]).toEqual([1, undefined, true]);
  Object.defineProperty(process, "argv", before);
  expect(hasFlag("only")).toBe(false);
});
`,
};

test("a compiled test run reads the process.argv that a test has put there", async () => {
  using dir = tempDir("aot-tests-replace-the-arguments", files);
  const tested = await run([bunExe(), "test", "--aot", "./arguments.test.js"], String(dir), bunEnv);
  expect(tested.stderr).toContain("6 pass");
  expect(tested.stderr).toContain("0 fail");
  expect(tested.exitCode).toBe(0);
}, 120_000);
