// `bun test` hands every file `test`, `expect`, `describe` and the other names of the runner, unless the file loads "bun:test", "@jest/globals"
// or "vitest" itself. `bun test --aot` reports what `bun test` reports, file by file.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

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
test("a file that imports a runner gets nothing more", () => { expect(typeof describe).toBe("undefined"); });
`,
  "imports-jest.test.js": `
import { expect, test } from "@jest/globals";
test("a file that imports a runner gets nothing more", () => { expect(typeof beforeAll).toBe("undefined"); });
`,
  "requires-the-runner.test.cjs": `
const { expect, test } = require("bun:test");
test("a file that requires the runner gets nothing more", () => { expect(typeof describe).toBe("undefined"); });
`,
  "imports-the-runner-by-a-call.test.js": `
const runner = await import("bun:test");
runner.test("a file that imports the runner by a call gets nothing more", () => { runner.expect(typeof describe).toBe("undefined"); });
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
  for (const file of Object.keys(files).filter(name => name.includes(".test."))) {
    test(
      file,
      async () => {
        using dir = tempDir("aot-test-runner-names", files);
        const plain = await report([], String(dir), file);
        expect(plain.lines.join("\n")).toContain("(pass)");
        expect(plain.lines.join("\n")).not.toContain("(fail)");
        expect(plain.exitCode).toBe(0);
        expect(await report(["--aot"], String(dir), file)).toEqual(plain);
        expect(await report(["--debug-aot"], String(dir), file)).toEqual(plain);
      },
      120_000,
    );
  }
});
