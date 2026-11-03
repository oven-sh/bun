import { expect } from "bun:test";
import { tempDir } from "harness";
import { fromDisk, runTests, sources, standInOf } from "./harness/test-files-from-disk-reach-what-they-name";
import { test } from "./supported";

// One of four files. Each case builds a project of its own: all in one took longer than CI gives a file under ASAN.

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

// What stands in for the files that a build does not see is no file. Each build prints its own, and once more where it starts over with less in it.
const showsStandIn = { ...fromDisk, BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1" };
test("test files from disk reach what they name", async () => {
  using dir = tempDir("aot-test-files-name", { ...sources, ...named });
  const plain = await runTests(String(dir), {});
  expect(plain.results.length).toBe(3);
  expect(plain.exitCode).toBe(0);
  const compiled = await runTests(String(dir), showsStandIn, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });

  const standIn = standInOf(compiled.stderr);
  const numberOf = (file: string) => standIn.match(new RegExp(`import \\* as (n\\d+) from ".*/src/${file}";`))?.[1];
  const counter = numberOf("counter\\.ts");
  expect(standIn).toContain(`sink(${counter}.default, ${counter}.increment, ${counter}.reset);`);
  expect(standIn).toContain(`sink(${numberOf("shapes\\.ts")}.square);`);
  const clock = numberOf("clock\\.ts");
  expect(standIn).toContain(`sink(${clock}.now, ${clock}.zone);`);
  expect(standIn).toContain(`spyOn(${numberOf("clock\\.ts")}, "now");`);
  expect(standIn).toContain(`sink(${numberOf("lazy\\.ts")}.lazy);`);
  expect(standIn).toContain(`sink(${numberOf("old\\.cjs")}.old);`);
  expect(numberOf("effects\\.ts")).toBeDefined();
  expect(standIn).toMatch(/mock\.module\(".*\/src\/clock\.ts", \(\) => \(\{\}\)\);/);
  expect(standIn).toContain(`mock.module("a-package-that-is-not-there", () => ({}));`);
  expect(standIn).not.toContain(`from "a-package-that-is-not-there"`);
  expect(standIn).not.toContain("neverNamed");
  expect(standIn).not.toContain("Shape");
  // A file of data is named by loads that never run: a statement would tell require() that the file has been imported.
  expect(standIn).toMatch(
    /sink\(await import\(".*\/src\/data\.json"\)\);\n  sink\(require\(".*\/src\/data\.json"\)\);/,
  );
  expect(standIn).not.toMatch(/from ".*\.json"/);
  const withoutData = standIn.replaceAll(/sink\(.*\.json"\)\);/g, "");
  expect(withoutData).not.toContain("import(");
  expect(withoutData).not.toContain("require(");
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
  const compiled = await runTests(String(dir), showsStandIn, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
  const standIn = standInOf(compiled.stderr);
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
  const compiled = await runTests(String(dir), showsStandIn, "--aot");
  expect({ results: compiled.results, exitCode: compiled.exitCode }).toEqual({ results: plain.results, exitCode: 0 });
  const standIn = standInOf(compiled.stderr);
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
