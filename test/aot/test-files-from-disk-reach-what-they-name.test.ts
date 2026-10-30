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
test("a fresh copy of a file imports one that no test names", async () => {
  expect(typeof (await import("../src/outer.ts?again")).outer()).toBe("number");
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
  expect(plain.results.filter(result => result.startsWith("pass")).length).toBe(3);
  const compiled = await runTests(String(dir), fromDisk, "--aot");
  expect(compiled.results.filter(result => result.startsWith("fail")).length).toBe(3);
  const refusals = [
    ...compiled.stderr.matchAll(
      /Cannot load '.*\/src\/inner\.ts' from '.*\/((?:src|tests)\/[^']*)': it's compiled into this test run, but no test file imports it by a constant path/g,
    ),
  ].map(match => match[1]);
  expect(refusals.sort()).toEqual(["src/outer.ts?again", "tests/paths.test.ts", "tests/paths.test.ts"]);
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
