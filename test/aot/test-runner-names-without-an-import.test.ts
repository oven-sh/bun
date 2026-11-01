// `bun test` hands every file `test`, `expect`, `describe` and the other names of the runner, also a file that loads "bun:test", "@jest/globals"
// or "vitest" itself. `bun test --aot` reports what `bun test` reports, file by file.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { describe, testOneByOne as test } from "./supported";

const files = {
  "tsconfig.json": `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "strict": true, "typeRoots": ["./no-types-here"] } }`,
  "every-name.test.js": `
console.log("row:", [typeof test, typeof it, typeof describe, typeof expect, typeof expectTypeOf, typeof beforeAll, typeof beforeEach].join());
console.log("row:", [typeof afterEach, typeof afterAll, typeof jest, typeof vi, typeof xit, typeof xtest, typeof xdescribe].join());
let order = "";
beforeAll(() => { order += "A"; });
beforeEach(() => { order += "e"; });
afterEach(() => { order += "f"; });
afterAll(() => { console.log("row:", order); });
describe("a group", () => {
  it("has a test", () => { expect(jest.fn()).not.toHaveBeenCalled(); expect(vi.fn()).not.toHaveBeenCalled(); });
  test("and another", () => { expectTypeOf(1).toBeNumber(); });
  xit("and one that is skipped", () => { throw new Error("it ran"); });
  xtest("and a second", () => { throw new Error("it ran"); });
});
xdescribe("a group that is skipped", () => { it("has a test", () => { throw new Error("it ran"); }); });
`,
  "names-of-one-runner.test.js": `
console.log("row:", [typeof onTestFinished, typeof aroundEach, typeof aroundAll, typeof jest, typeof xit].join());
console.log("row:", [typeof suite, typeof vitest, typeof onTestFailed, typeof assertType].join());
test("a name is called", () => { onTestFinished(() => console.log("row: finished")); });
`,
  "names-of-vitest.test.js": `
import { test } from "vitest";
console.log("row:", [typeof onTestFinished, typeof aroundEach, typeof aroundAll, typeof jest, typeof xit].join());
console.log("row:", [typeof suite, typeof vitest, typeof onTestFailed, typeof assertType].join());
suite("a group", () => { test("has a test", () => { onTestFailed(() => {}); }); });
`,
  "commonjs.test.cjs": `
const path = require("node:path");
test("in a CommonJS file", () => { expect(path.posix.sep).toBe("/"); expect(typeof module).toBe("object"); });
module.exports = {};
`,
  "behind-a-directive.test.cjs": `"use strict";
test("the directive still counts", () => { expect((function () { return this; })()).toBe(undefined); });
`,
  "declares-the-names.test.ts": `
declare const test: (name: string, run: () => void) => void;
declare const expect: (value: unknown) => { toBe(expected: unknown): void };
test("names that the file only declares", () => { expect(1).toBe(1); });
`,
  "has-the-names-itself.test.js": `
function describe(text) { return "mine: " + text; }
test("a name that the file defines is the file's", () => {
  expect(describe("x")).toBe("mine: x");
  const it = 5;
  expect(it).toBe(5);
  expect((jest => jest + 1)(1)).toBe(2);
});
`,
  "shorthand.test.js": `
const names = { test, expect };
test("a shorthand property", () => {
  names.expect(Object.keys(names).join()).toBe("test,expect");
  expect(names.test).toBe(test);
});
`,
  "helper.js": `
export function check(value) { expect(value).toBe(1); }
`,
  "uses-a-helper.test.js": `
import { check } from "./helper.js";
test("a file that is no test file has the names too", () => { check(1); });
`,
  "imports-another-runner.test.js": `
import { expect, test } from "vitest";
test("a file that imports a runner has the other names too", () => { expect(typeof describe).toBe("function"); });
`,
  "defines-expect.js": `
globalThis.expect = value => ({ to: { equal(other) { console.log("row:", value === other ? "equal" : "not equal"); } } });
`,
  "has-a-global-of-a-preload.test.js": `
import { test } from "bun:test";
test("a file that imports a runner has the global that a preload defined", () => { expect(1).to.equal(1); console.log("row:", typeof describe); });
`,
  "has-no-global-of-a-preload.test.js": `
test("a file that imports no runner has the runner's", () => { expect(typeof expect(1).to).toBe("undefined"); });
`,
  "imports-jest.test.js": `
import { expect, test } from "@jest/globals";
test("a file that imports a runner has the other names too", () => { expect(typeof beforeAll).toBe("function"); });
`,
  "requires-the-runner.test.cjs": `
const { expect, test } = require("bun:test");
test("a file that requires the runner has the other names too", () => { expect(typeof describe).toBe("function"); });
`,
  "imports-the-runner-by-a-call.test.js": `
const runner = await import("bun:test");
runner.test("a file that imports the runner by a call has the other names too", () => { runner.expect(typeof describe).toBe("function"); });
`,
};

async function report(mode: string[], directory: string, file: string) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...mode, "./" + file], directory);
  const lines = (stdout + "\n" + stderr)
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)|^row: |^ *\d+ (pass|fail|skip)$|Error: |error: /.test(line));
  return { lines: lines.map(line => line.replace(/ \[[\d.]+m?s\]$/, "")).sort(), exitCode };
}

describe("the names of the test runner without an import", () => {
  const testFiles = Object.keys(files).filter(name => name.includes(".test."));
  const withPreload = testFiles.filter(name => name.includes("-of-a-preload."));
  const rows = [
    ...testFiles.filter(file => !withPreload.includes(file)).map(file => [file, []] as const),
    ["names-of-one-runner.test.js", ["--globals=vitest"]] as const,
    ...withPreload.map(file => [file, ["--preload=./defines-expect.js"]] as const),
  ];
  for (const [file, flags] of rows) {
    test(
      [file, ...flags].join(" "),
      async () => {
        using dir = tempDir("aot-test-runner-names", files);
        const plain = await report([...flags], String(dir), file);
        expect(plain.lines.join("\n")).toContain("(pass)");
        expect(plain.lines.join("\n")).not.toContain("(fail)");
        expect(plain.exitCode).toBe(0);
        expect(await report([...flags, "--aot"], String(dir), file)).toEqual(plain);
        expect(await report([...flags, "--debug-aot"], String(dir), file)).toEqual(plain);
      },
      120_000,
    );
  }
});
