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
  "named-by-a-define.test.js": `
IT("a define names the test", () => { expect(1).toBe(1); });
`,
  "declares-what-a-define-names.test.ts": `
declare const IT: (name: string, run: () => void) => void;
IT("a define names the test, and the file declares the name of the define", () => { expect(1).toBe(1); });
`,
  "shorthand-named-by-a-define.test.js": `
const names = { IT, expect };
names.IT("a shorthand property that a define names", () => {
  names.expect(Object.keys(names).join()).toBe("IT,expect");
});
`,
  "runner-name-named-by-a-define.test.js": `
xit("a define names the test in place of a name of the runner", () => { expect(1).toBe(1); });
`,
  "replaced-by-a-define.test.js": `
globalThis.report = name => { console.log("row:", name); };
xtest("a define names a global in place of a name of the runner");
xdescribe("row: a define names a member of a global in place of a name of the runner");
it.todo("a define names a global in place of a member of a name of the runner");
let found;
try { found = typeof xit; } catch (error) { found = error.name; }
console.log("row: a define names a member of the name in its own place:", found);
test("and the other names are the runner's", () => { expect(typeof vi).toBe("object"); });
`,
  "named-by-a-define-with-a-dotted-key.test.js": `
process.env.IT("a define with a dotted key names the test", () => { expect(1).toBe(1); });
`,
  "named-by-a-define-of-import-meta.test.js": `
import.meta.IT("a define of a member of import.meta names the test", () => { expect(1).toBe(1); });
`,
  "declares-the-holder-of-what-a-define-names.test.ts": `
declare const holder: { IT: (name: string, run: () => void) => void };
holder.IT("a define with a dotted key names the test, and the file declares the holder", () => { expect(1).toBe(1); });
`,
  "member-of-a-runner-name-named-by-a-define.test.js": `
it.skip("a define names the test in place of a member of a name of the runner", () => { expect(1).toBe(1); });
it("and the name alone is the runner's", () => { expect(1).toBe(1); });
`,
  "member-named-by-a-define.test.js": `
IT("a define names a member of a name of the runner", () => { throw new Error("it ran"); });
test("and finds the name that another use has imported", () => { expect(1).toBe(1); });
`,
  "declares-what-a-define-names-a-member-for.test.ts": `
declare const IT: (name: string, run: () => void) => void;
IT("a define names a member of a name of the runner, and the file declares the name of the define", () => { throw new Error("it ran"); });
test("and finds the name that another use has imported", () => { expect(1).toBe(1); });
`,
  "runner-names-named-by-defines-with-members.test.js": `
describe("a group", () => {
  it("has a test", () => { expect(1).toBe(1); });
  xit("and one that a define skips", () => { throw new Error("it ran"); });
});
xdescribe("a group that a define skips", () => { it("has a test", () => { throw new Error("it ran"); }); });
`,
  "constants-in-place-of-runner-names.test.js": `
console.log("row: defines write constants in place of names of the runner:", typeof vi, typeof xit === "string" ? xit : "no string");
test("and the other names are the runner's", () => { expect(typeof jest).toBe("object"); });
`,
  "evaluated-text-declares-what-a-define-names.test.cjs": `
function run(text) {
  eval(text);
  IT("row: a define names what the evaluated text declares");
}
run("var test = name => { console.log(name); };");
it("and the runner has its own name", () => { expect(1).toBe(1); });
`,
  "evaluated-text-declares-another-name.test.cjs": `
function run(text) {
  eval(text);
  IT("a define names the test beside evaluated text that declares another name", () => { expect(1).toBe(1); });
}
run("var other = 1;");
`,
  "stored-to-through-a-define.test.js": `
let thrown = "nothing";
try { IT = 5; } catch (error) { thrown = error.constructor.name; }
let taken = "nothing";
try { ({ IT } = { IT: 1 }); } catch (error) { taken = error.constructor.name; }
console.log("row: a store through a define to a name of the runner throws", thrown, "and", taken, "and the name stays a", typeof IT);
test("and the name is the runner's", () => { expect(1).toBe(1); });
`,
  "stores-through-a-define.test.cjs": `
const tried = [];
const attempt = (name, run) => { try { run(); tried.push(name + " nothing"); } catch (error) { tried.push(name + " " + error.constructor.name); } };
attempt("a store", () => { IT = 1; });
attempt("an update", () => { IT++; });
attempt("a compound store", () => { IT += 1; });
attempt("a pattern", () => { [IT] = [1]; });
attempt("a loop", () => { for (IT of [1]) {} });
console.log("row: through a define to a name of the runner,", tried.join(", "), "throw, and the name stays a", typeof IT);
test("and the name is the runner's", () => { expect(1).toBe(1); });
`,
  "declares-what-a-define-stores-to.test.ts": `
declare let IT: number;
let thrown = "nothing";
try { IT = 5; } catch (error) { thrown = (error as Error).constructor.name; }
console.log("row: a store through a define to a name of the runner throws", thrown);
test("and the name is the runner's", () => { expect(1).toBe(1); });
`,
};

// What `bun test --define` is told for a file. It writes the value where the file has the key. A value of one name is a use of that
// name there, also where the program stores to it or looks it up when the code runs. The first name of a value with members is none:
// what is written there finds the name only where another use has it imported. The key is no use of the name that it spells, whatever
// the value is. The run of constants-in-place-of-runner-names has a define that names the test too, whose key the file does not have.
const defines: Record<string, string[]> = {
  "named-by-a-define.test.js": ["IT=test"],
  "declares-what-a-define-names.test.ts": ["IT=test"],
  "shorthand-named-by-a-define.test.js": ["IT=test"],
  "runner-name-named-by-a-define.test.js": ["xit=it"],
  "replaced-by-a-define.test.js": ["xtest=report", "xdescribe=console.log", "xit=xit.skip", "it.todo=report"],
  "named-by-a-define-with-a-dotted-key.test.js": ["process.env.IT=test"],
  "named-by-a-define-of-import-meta.test.js": ["import.meta.IT=test"],
  "declares-the-holder-of-what-a-define-names.test.ts": ["holder.IT=test"],
  "member-of-a-runner-name-named-by-a-define.test.js": ["it.skip=it"],
  "member-named-by-a-define.test.js": ["IT=test.skip"],
  "declares-what-a-define-names-a-member-for.test.ts": ["IT=test.skip"],
  "runner-names-named-by-defines-with-members.test.js": ["xit=it.skip", "xdescribe=describe.skip"],
  "constants-in-place-of-runner-names.test.js": ["vi=undefined", 'xit="text"', "IT=test"],
  "evaluated-text-declares-what-a-define-names.test.cjs": ["IT=test"],
  "evaluated-text-declares-another-name.test.cjs": ["IT=test"],
  "stored-to-through-a-define.test.js": ["IT=test"],
  "stores-through-a-define.test.cjs": ["IT=test"],
  "declares-what-a-define-stores-to.test.ts": ["IT=test"],
};

async function report(mode: string[], directory: string, file: string) {
  const flags = (defines[file] ?? []).flatMap(define => ["--define", define]);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...mode, ...flags, "./" + file], directory);
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
