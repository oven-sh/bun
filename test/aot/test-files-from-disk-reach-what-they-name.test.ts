import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const sources = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "src/counter.ts": `let count = 0;
export function increment(): number { return ++count; }
export function reset(): void { count = 0; }
export function neverNamed(): string { return "never named"; }
export default function current(): number { return count; }
`,
  "src/shapes.ts": `export type Shape = { sides: number };
export const square: Shape = { sides: 4 };
export const triangle: Shape = { sides: 3 };
`,
  "src/clock.ts": `export function now(): number { return Date.now(); }
export function zone(): string { return "UTC"; }
`,
  "src/lazy.ts": `export const lazy = "lazy";`,
  "src/old.cjs": `module.exports = { old: () => "old" };`,
  "src/data.json": `{ "answer": 42 }`,
  "src/effects.ts": `(globalThis as any).effects = ((globalThis as any).effects ?? 0) + 1;`,
  "src/inner.ts": `let calls = 0;
export function inner(): number { return ++calls; }
`,
  "src/outer.ts": `import { inner } from "./inner";
export function outer(): number { return inner(); }
`,
};

const named = {
  "tests/imports.test.ts": `import { expect, spyOn, test } from "bun:test";
import current, { increment, reset as clear } from "../src/counter";
import type { Shape } from "../src/shapes";
import { type Shape as Other, square } from "../src/shapes";
import * as clock from "../src/clock";
import "../src/effects";
import data from "../src/data.json";
test("names, a default, a file for its effects, data", () => {
  clear();
  expect(increment()).toBe(1);
  expect(current()).toBe(1);
  const shape: Shape | Other = square;
  expect(shape.sides).toBe(4);
  expect(data.answer).toBe(42);
  expect((globalThis as any).effects).toBe(1);
});
test("a spy on an export", () => {
  const spy = spyOn(clock, "now").mockReturnValue(7);
  expect(clock.now()).toBe(7);
  spy.mockRestore();
});
`,
  "tests/loads.test.ts": `import { expect, mock, test } from "bun:test";
mock.module("../src/clock", () => ({ now: () => 1, zone: () => "mocked" }));
mock.module("a-package-that-is-not-there", () => ({ value: 5 }));
test("import(), require() and mocks", async () => {
  expect((await import("../src/lazy")).lazy).toBe("lazy");
  expect(require("../src/old.cjs").old()).toBe("old");
  expect((await import("../src/clock")).zone()).toBe("mocked");
  // @ts-ignore
  expect((await import("a-package-that-is-not-there")).value).toBe(5);
});
`,
};

const withJSX = {
  "tsconfig.json": `{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "tiny" } }`,
  "node_modules/tiny/package.json": `{ "name": "tiny", "version": "1.0.0", "type": "module" }`,
  "node_modules/tiny/made.js": `export const made = [];`,
  "node_modules/tiny/jsx-runtime.js": `import { made } from "./made.js";
export function jsx(type, props) { made.push(type); return { type, props }; }
export const jsxs = jsx;
export const Fragment = "fragment";
`,
  "node_modules/tiny/jsx-dev-runtime.js": `import { made } from "./made.js";
export function jsxDEV(type, props) { made.push(type); return { type, props }; }
export const Fragment = "fragment";
`,
  "src/view.tsx": `export function view() { return <p>compiled</p>; }`,
  "tests/jsx.test.tsx": `import { expect, test } from "bun:test";
import { view } from "../src/view";
test("JSX in a test file and in a compiled file", () => {
  expect((<b>from disk</b>).type).toBe("b");
  expect(view().type).toBe("p");
});
`,
};

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

const copies = {
  "node_modules/dual/package.json": `{ "name": "dual", "version": "1.0.0", "exports": { ".": { "import": "./esm.mjs", "require": "./cjs.cjs" } } }`,
  "node_modules/dual/esm.mjs": `export const kind = "esm";`,
  "node_modules/dual/cjs.cjs": `module.exports = { kind: "cjs" };`,
  "tests/copies.test.ts": `import { expect, test } from "bun:test";
import { kind } from "dual";
import { outer } from "../src/outer";
test("a copy of a file under a query imports what the file imports", async () => {
  expect(outer()).toBe(1);
  const copy = await import("../src/outer.ts?again");
  expect(copy.outer).not.toBe(outer);
  expect(copy.outer()).toBe(2);
});
test("an evicted file is loaded again", () => {
  const first = require("../src/old.cjs");
  delete require.cache[require.resolve("../src/old.cjs")];
  expect(require("../src/old.cjs")).not.toBe(first);
  expect(require("../src/old.cjs").old()).toBe("old");
});
test("the file of a package for require(), where the test spells an import", () => {
  expect(kind).toBe("esm");
  expect(require(["du", "al"].join("")).kind).toBe("cjs");
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

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./tests"], directory, {
    ...bunEnv,
    ...env,
  });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return { results: results.sort(), exitCode, stderr };
}

const fromDisk = { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" };

test("test files from disk reach what they name", async () => {
  using dir = tempDir("aot-test-files-name", { ...sources, ...named });
  const plain = await runTests(String(dir), {});
  expect(plain.results.length).toBe(3);
  expect(plain.exitCode).toBe(0);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });

  const standIn = readFileSync(join(String(dir), "node_modules/.cache/bun-test-files-from-disk.js"), "utf8");
  const numberOf = (file: string) => standIn.match(new RegExp(`import \\* as (n\\d+) from ".*/src/${file}";`))?.[1];
  const counter = numberOf("counter\\.ts");
  expect(standIn).toContain(`sink(${counter}.default, ${counter}.increment, ${counter}.reset);`);
  expect(standIn).toContain(`sink(${numberOf("shapes\\.ts")}.square);`);
  expect(standIn).toContain(`sink(${numberOf("clock\\.ts")});`);
  expect(standIn).toContain(`spyOn(${numberOf("clock\\.ts")}, "now");`);
  expect(standIn).toContain(`sink(${numberOf("lazy\\.ts")});`);
  expect(standIn).toContain(`sink(${numberOf("old\\.cjs")});`);
  expect(numberOf("effects\\.ts")).toBeDefined();
  expect(standIn).toMatch(/mock\.module\(".*\/src\/clock\.ts", \(\) => \(\{\}\)\);/);
  expect(standIn).toContain(`mock.module("a-package-that-is-not-there", () => ({}));`);
  expect(standIn).not.toContain(`from "a-package-that-is-not-there"`);
  expect(standIn).not.toContain("neverNamed");
  expect(standIn).not.toContain("Shape");
  expect(standIn).not.toContain("import(");
  expect(standIn).not.toContain("require(");
}, 60_000);

test("a test file with JSX reaches the run time of JSX, which it does not spell", async () => {
  using dir = tempDir("aot-test-files-jsx", { "package.json": sources["package.json"], ...withJSX });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass JSX in a test file and in a compiled file"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
}, 60_000);

test("copies of files, evicted files and the two files of a package", async () => {
  using dir = tempDir("aot-test-files-copies", { ...sources, ...copies });
  const plain = await runTests(String(dir), {});
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(3);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
  const standIn = readFileSync(join(String(dir), "node_modules/.cache/bun-test-files-from-disk.js"), "utf8");
  expect(standIn).toMatch(/await import\(".*\/src\/outer\.ts\?again"\);/);
  expect(standIn).toMatch(/delete require\.cache\[require\.resolve\(".*\/src\/old\.cjs"\)\];/);
  expect(standIn).toMatch(/import \* as n\d+ from ".*\/src\/inner\.ts";/);
  expect(standIn).toMatch(/import \* as n\d+ from ".*\/node_modules\/dual\/cjs\.cjs";/);
  expect(standIn).not.toContain("require.cache[other]");
}, 60_000);

test("a test file that imports another test file", async () => {
  using dir = tempDir("aot-test-files-import-test-files", {
    "package.json": sources["package.json"],
    "src/inner.ts": sources["src/inner.ts"],
    "tests/first.test.ts": `import { expect, test } from "bun:test";
import { inner } from "../src/inner";
export const shared = "shared";
test("first", () => {
  expect(typeof inner()).toBe("number");
});
`,
    "tests/second.test.ts": `import { expect, test } from "bun:test";
import { shared } from "./first.test";
test("second", () => {
  expect(shared).toBe("shared");
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.exitCode).toBe(0);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
  const standIn = readFileSync(join(String(dir), "node_modules/.cache/bun-test-files-from-disk.js"), "utf8");
  expect(standIn).not.toContain(".test");
}, 60_000);

test("the loader links what a compiled preload imports, though no test file names it", async () => {
  using dir = tempDir("aot-test-files-preload", {
    "package.json": sources["package.json"],
    "bunfig.toml": `[test]\npreload = ["./preload.ts"]\n`,
    "preload.ts": `import { lookUp } from "./src/reader";
(globalThis as any).fromPreload = lookUp("b");
`,
    "src/reader.ts": `import { table, names } from "./table";
export function lookUp(name: string): number { return names.has(name) ? table[name]! : -1; }
`,
    "src/table.ts": `export const table: Record<string, number> = { a: 1, b: 2 };
export const names = new Set(Object.keys(table));
`,
    "tests/preloaded.test.ts": `import { expect, test } from "bun:test";
test("preloaded", () => {
  expect((globalThis as any).fromPreload).toBe(2);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass preloaded"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
}, 60_000);

test("require.cache lists a CommonJS file that no test file names and does not hand it out", async () => {
  using dir = tempDir("aot-test-files-require-cache", {
    "package.json": `{ "name": "suite" }`,
    "src/state.cjs": `exports.count = 0;\nexports.bump = () => ++exports.count;`,
    "src/user.cjs": `const state = require("./state.cjs");\nexports.use = () => state.bump();`,
    "tests/cache.test.js": `import { expect, test } from "bun:test";
import { join } from "node:path";
const { use } = require("../src/user.cjs");
const path = join(import.meta.dir, "../src", ["sta", "te"].join("") + ".cjs");
test("the key", () => {
  expect(use()).toBe(1);
  expect(Object.keys(require.cache)).toContain(path);
  expect(path in require.cache).toBe(true);
});
test("the entry", () => {
  expect(require.cache[path].exports.count).toBe(1);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass the entry", "pass the key"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results).toEqual(["fail the entry", "pass the key"]);
  expect(compiled.stderr).toMatch(
    /Cannot load '[^']*\/src\/state\.cjs'[^:]*: it's compiled into this test run, but no test file imports it by a constant path/,
  );
}, 60_000);

test("compiled code reads an export that no test file names off what require() and import() answer", async () => {
  using dir = tempDir("aot-test-files-compiled-readers", {
    "package.json": sources["package.json"],
    "src/list.ts": `export const LIST: readonly string[] = ["a", "b"];
export const OTHER: readonly string[] = ["c"];
`,
    "src/user.ts": `const flag = true;
const list = flag ? (require("./list.js") as typeof import("./list.js")).LIST : [];
export const count = list.length;
export async function late(name: "LIST" | "OTHER"): Promise<number> { return (await import("./other.ts"))[name].length; }
`,
    "src/other.ts": `export const LIST: readonly string[] = ["a", "b"];
export const OTHER: readonly string[] = ["c"];
`,
    "src/holder.ts": `const held = require("./list.js") as typeof import("./list.js");
function load() { return require("./list.js") as typeof import("./list.js"); }
export function counts(): number[] { return [held.LIST.length, load().OTHER.length]; }
`,
    "tests/readers.test.ts": `import { expect, test } from "bun:test";
import { join } from "node:path";
import { counts } from "../src/holder";
import { count, late } from "../src/user";
test("readers", async () => {
  expect(count).toBe(2);
  expect(counts()).toEqual([2, 1]);
  expect(await late("OTHER")).toBe(1);
});
test("the same export from outside", async () => {
  const path = join(import.meta.dir, "../src", ["li", "st"].join("") + ".ts");
  expect((await import(path)).LIST.length).toBe(2);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass readers", "pass the same export from outside"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  // list.ts is no entry point, so the file itself is refused. What matters here: the compiled readers go through.
  expect(compiled.results).toEqual(["fail the same export from outside", "pass readers"]);
}, 60_000);

test("a Worker starts from a file that compiled code names by a URL and hands through functions", async () => {
  using dir = tempDir("aot-test-files-worker", {
    "package.json": sources["package.json"],
    "src/inner.ts": sources["src/inner.ts"],
    "src/outer.ts": sources["src/outer.ts"],
    "src/deep/url.ts": `export const workerUrl = (): string | URL => new URL("../spawned.ts", import.meta.url);`,
    "src/spawn.ts": `import { outer } from "./outer";
import { workerUrl } from "./deep/url";
export function here(): number { return outer(); }
export function spawn(entry: string | URL = workerUrl()): Promise<number> {
  const worker = new Worker(entry);
  return new Promise(resolve => {
    worker.onmessage = event => { resolve(event.data); worker.terminate(); };
  });
}
`,
    "src/spawned.ts": `import { outer } from "./outer";
postMessage(outer() + 10);
`,
    "tests/worker.test.ts": `import { expect, test } from "bun:test";
import { here, spawn } from "../src/spawn";
test("worker", async () => {
  expect(here()).toBe(1);
  expect(await spawn()).toBe(11);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass worker"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
}, 60_000);

test("a path that a test file spells outside the import(), and a test file that a compiled file imports", async () => {
  using dir = tempDir("aot-test-files-spelled", {
    "package.json": sources["package.json"],
    "src/inner.ts": sources["src/inner.ts"],
    "src/outer.ts": sources["src/outer.ts"],
    "helpers/circle.js": `import { fromTest, later } from "../tests/circle.test.js";
export const fromHelper = "helper";
export const seen = () => [fromTest(), later].join();
`,
    "tests/circle.test.js": `import { expect, test } from "bun:test";
import { fromHelper, seen } from "../helpers/circle.js";
export function fromTest() { return "test sees " + fromHelper; }
export const later = "later";
test("circle", () => {
  expect(seen()).toBe("test sees helper,later");
});
`,
    "tests/spelled.test.ts": `import { expect, test } from "bun:test";
import { outer } from "../src/outer";
const load = (path: string) => import(path);
test("spelled", async () => {
  expect(outer()).toBe(1);
  expect((await load("../src/inner")).inner()).toBe(2);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass circle", "pass spelled"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
}, 60_000);

test("a test file is the first to ask for a module of data", async () => {
  using dir = tempDir("aot-test-files-data", {
    "package.json": sources["package.json"],
    "src/data.json": sources["src/data.json"],
    "tests/data.test.ts": `import { expect, test } from "bun:test";
import data from "../src/data.json";
test("data", () => {
  expect(data.answer).toBe(42);
});
`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass data"]);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
}, 60_000);

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
