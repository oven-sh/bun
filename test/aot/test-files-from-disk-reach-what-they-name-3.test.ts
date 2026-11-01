import { expect } from "bun:test";
import { tempDir } from "harness";
import { fromDisk, runTests, sources } from "./harness/test-files-from-disk-reach-what-they-name";
import { test } from "./supported";

// One of four files. Each case builds a project of its own: all in one took longer than CI gives a file under ASAN.

const notNamed = {
  "tests/paths.test.ts": `import { expect, test } from "bun:test";
import { join } from "node:path";
import { outer } from "../src/outer";
const path = join(import.meta.dir, "../src", ["in", "ner"].join("") + ".ts");
test("import() of a path made at run time", async () => {
  expect(outer()).toBe(1);
  expect((await import(path)).inner()).toBe(2);
});
test("require() of a path made at run time", () => {
  expect(typeof require(path).inner()).toBe("number");
});
`,
};

const namesNotNamed = {
  "src/used.ts": `export function named(): string { return "named"; }
export function usedByCompiledCode(n: number): number { return n + 1; }
export function usedByNobody(): string { return "nobody"; }
export const numberOfNobody = 5;
`,
  "src/user.ts": `import { usedByCompiledCode } from "./used";
export function use(): number { return usedByCompiledCode(1); }
`,
  "tests/helper.txt": `import { usedByCompiledCode } from "../src/used.ts";
export const answer = usedByCompiledCode(1);
`,
  "tests/names.test.ts": `import { expect, test } from "bun:test";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { named } from "../src/used";
import { use } from "../src/user";
const path = join(import.meta.dir, "../src", ["us", "ed"].join("") + ".ts");
test("what the test names", () => {
  expect(named()).toBe("named");
  expect(use()).toBe(2);
});
test("a name that only compiled code uses, off the namespace object", async () => {
  expect((await import(path)).usedByCompiledCode(1)).toBe(2);
});
test("a name that nobody uses, off the namespace object", async () => {
  expect((await import(path)).usedByNobody()).toBe("nobody");
});
test("a number that nobody uses, off the namespace object", async () => {
  expect((await import(path)).numberOfNobody).toBe(5);
});
test("a module written at run time imports a name that only compiled code uses", async () => {
  const written = join(import.meta.dir, "written.ts");
  copyFileSync(join(import.meta.dir, "helper.txt"), written);
  expect((await import(written)).answer).toBe(2);
});
`,
};

test("a path that finds a compiled file which no test file names is refused by name", async () => {
  using dir = tempDir("aot-test-files-do-not-name", { ...sources, ...notNamed });
  const plain = await runTests(String(dir), {});
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(2);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results.filter(result => result.startsWith("fail")).length).toBe(2);
  const refusals = [
    ...compiled.stderr.matchAll(
      /Cannot load '.*\/src\/inner\.ts' from '.*\/((?:src|tests)\/[^']*)': it's compiled into this test run, but no test file imports it by a constant path/g,
    ),
  ].map(match => match[1]);
  expect(refusals.sort()).toEqual(["tests/paths.test.ts", "tests/paths.test.ts"]);
}, 60_000);

test("an export that no test file names is refused by module, name and asker", async () => {
  using dir = tempDir("aot-test-files-do-not-name-exports", {
    "package.json": sources["package.json"],
    ...namesNotNamed,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(5);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results).toEqual([
    "fail a module written at run time imports a name that only compiled code uses",
    "fail a name that nobody uses, off the namespace object",
    "fail a name that only compiled code uses, off the namespace object",
    "pass a number that nobody uses, off the namespace object",
    "pass what the test names",
  ]);
  const refusals = [
    ...compiled.stderr.matchAll(
      /Cannot read the export '(\w+)' of '[^']*\/src\/used\.ts'(?: from '[^']*\/(tests\/[^']*)')?: the file is compiled into this test run, but no test file imports that name/g,
    ),
  ].map(match => `${match[1]} ${match[2] ?? ""}`.trim());
  // The linker does not say for whom it resolves a name: the failed import() of the written module does.
  expect(refusals.sort()).toEqual(["usedByCompiledCode", "usedByCompiledCode", "usedByNobody"]);
}, 60_000);

test("a module that a test file imports as an object and uses by name is open under those names alone", async () => {
  using dir = tempDir("aot-test-files-use-an-object-by-name", {
    "package.json": sources["package.json"],
    "src/used.ts": `export function read(): string { return "read"; }
export function asked(): string { return "asked"; }
export function quoted(): string { return "quoted"; }
export function usedByNobody(): string { return "nobody"; }
`,
    "src/spied.ts": `import { isatty } from "tty";
import { one } from "./handed";
export function spiedOn(): string { return "the original"; }
export function callsSpiedOn(): string { return spiedOn(); }
export function asksForTerminal(): boolean { return isatty(987); }
export function handsOver(): typeof import("./handed") { return require("./handed"); }
export function callsOne(): number { return one(); }
`,
    "src/handed.ts": `export function one(): number { return 1; }
export function other(): number { return 2; }
`,
    "src/whole.ts": `export function one(): number { return 1; }
export function two(): number { return 2; }
`,
    "tests/by-name.test.ts": `import { expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import * as tty from "tty";
import * as spied from "../src/spied";
import * as used from "../src/used";
import * as whole from "../src/whole";
// used.notThere is a word in a comment, and so is src/used/x or well-used.
const keys = { used: 1 };
type Used = typeof used;
const path = join(import.meta.dir, "../src", ["us", "ed"].join("") + ".ts");
test("names read off the object", () => {
  expect(used.read()).toBe("read");
  expect(used?.asked()).toBe("asked");
  expect(used["quoted"]()).toBe("quoted");
  expect(keys.used).toBe(1);
});
test("a spy written over several lines", () => {
  const spy = spyOn(
    spied,
    "spiedOn",
  ).mockReturnValue("the spy");
  expect(spied.callsSpiedOn()).toBe("the spy");
  spy.mockRestore();
  expect(spied.callsSpiedOn()).toBe("the original");
});
test("a spy on an export of a module of Bun", () => {
  const spy = spyOn(tty, "isatty").mockReturnValue(true);
  expect(spied.asksForTerminal()).toBe(true);
  spy.mockRestore();
  expect(spied.asksForTerminal()).toBe(false);
});
test("a spy on an object that compiled code hands over", () => {
  const handed = spied.handsOver();
  const spy = spyOn(handed, "one").mockReturnValue(5);
  expect(spied.callsOne()).toBe(5);
  spy.mockRestore();
  expect(spied.callsOne()).toBe(1);
});
test("an object that goes somewhere is open as a whole", () => {
  expect(Object.values(whole).map(it => it())).toEqual([1, 2]);
});
test("a name that the text does not read off the object", async () => {
  expect((await import(path)).usedByNobody()).toBe("nobody");
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(6);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results).toEqual([
    "fail a name that the text does not read off the object",
    "pass a spy on an export of a module of Bun",
    "pass a spy on an object that compiled code hands over",
    "pass a spy written over several lines",
    "pass an object that goes somewhere is open as a whole",
    "pass names read off the object",
  ]);
  expect(compiled.stderr).toMatch(/Cannot read the export 'usedByNobody' of '[^']*\/src\/used\.ts'/);
}, 60_000);

test("a load opens what the test file takes of it", async () => {
  const names = ["taken", "renamed", "withDefault", "offLocal", "spiedOn", "offAwait", "offRequire", "assigned"];
  const exports = [...names, "usedByNobody"]
    .map(name => `export function ${name}(): string { return "${name}"; }\n`)
    .join("");
  using dir = tempDir("aot-test-files-from-disk-loads", {
    "package.json": `{ "type": "module" }`,
    "src/pattern.ts": exports,
    "src/local.ts": exports + `export function callsSpiedOn(): string { return spiedOn(); }\n`,
    "src/member.ts": exports,
    "src/assigned.ts": exports,
    "src/types.ts": exports + `export type Shape = { a: number };\n`,
    "src/whole.ts": exports,
    "src/then.ts": exports,
    "tests/loads.test.ts": `import { beforeAll, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
const at = (name: string) => join(import.meta.dir, "../src", [name, "ts"].join("."));
let later: typeof import("../src/assigned");
let shape: import("../src/types").Shape = { a: 1 };
beforeAll(async () => {
  later = await import("../src/assigned");
});
test("a pattern", async () => {
  const { taken, renamed: other, withDefault = () => "none" } = await import("../src/pattern");
  expect([taken(), other(), withDefault()]).toEqual(["taken", "renamed", "withDefault"]);
});
test("a name for the object", async () => {
  const loaded = await import("../src/local");
  expect(loaded.offLocal()).toBe("offLocal");
  const spy = spyOn(loaded, "spiedOn").mockReturnValue("the spy");
  expect(loaded.callsSpiedOn()).toBe("the spy");
  spy.mockRestore();
});
test("a member", async () => {
  expect((await import("../src/member")).offAwait()).toBe("offAwait");
  expect(require("../src/member").offRequire()).toBe("offRequire");
});
test("a store", () => {
  expect(later.assigned()).toBe("assigned");
  expect(shape.a).toBe(1);
});
test("the object goes somewhere", async () => {
  const whole = await import("../src/whole");
  expect(Object.keys(whole).length).toBe(${names.length + 1});
  const answer = await import("../src/then").then(it => it.usedByNobody());
  expect(answer).toBe("usedByNobody");
});
for (const name of ["pattern", "local", "member", "assigned"]) {
  test("not taken of " + name, async () => {
    expect((await import(at(name))).usedByNobody()).toBe("usedByNobody");
  });
}
test("only types are taken", async () => {
  expect((await import(at("types"))).taken()).toBe("taken");
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(10);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results).toEqual([
    "fail not taken of assigned",
    "fail not taken of local",
    "fail not taken of member",
    "fail not taken of pattern",
    "fail only types are taken",
    "pass a member",
    "pass a name for the object",
    "pass a pattern",
    "pass a store",
    "pass the object goes somewhere",
  ]);
  for (const name of ["pattern", "local", "member", "assigned"])
    expect(compiled.stderr).toMatch(new RegExp(`Cannot read the export 'usedByNobody' of '[^']*/src/${name}\\.ts'`));
  expect(compiled.stderr).toMatch(/Cannot read the export 'taken' of '[^']*\/src\/types\.ts'/);
}, 60_000);
