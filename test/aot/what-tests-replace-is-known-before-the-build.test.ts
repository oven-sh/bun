import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

// The build holds what the test files import and not the test files. What they replace is found by a scan of the test files ahead of the build.
const env = { ...bunEnv, BUN_AOT_TEST_FILES_FROM_DISK: "1" };

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("what-tests-replace", files);
  const plain = await runTests(String(dir), ...flags);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot", ...flags)).toEqual(plain);
}

const app = {
  "src/parts.ts": `
    export function double(n: number): number { return n * 2; }
    export function triple(n: number): number { return n * 3; }
    export const unit = { name: "meter" };
    export let level = 1;`,
  "src/app.ts": `
    import { double, triple, unit, level } from "./parts";
    import { readFileSync } from "node:fs";
    import * as path from "node:path";
    export function sum(n: number): number { return double(n) + triple(n); }
    export function label(): string { return unit.name + level; }
    export function find(text: string, part: string): number { return text.indexOf(part); }
    export function keysOf(value: object): string[] { const keys = []; for (const key in value) keys.push(key); return keys; }
    export function base(file: string): string { return path.basename(file); }
    export function size(file: string): number { return readFileSync(file).length; }`,
};

test("spies on exports that the test files name", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `
      import { expect, jest, spyOn, test } from "bun:test";
      import * as parts from "./src/parts";
      import { sum } from "./src/app";
      test("spied", () => {
        console.log(sum(1));
        const spy = spyOn(parts, "double").mockImplementation(n => n + 100);
        console.log(sum(1), spy.mock.calls.length);
        spy.mockRestore();
        const other = jest.spyOn(parts as any, "triple").mockReturnValue(7);
        console.log(sum(1), other.mock.calls.length);
        other.mockRestore();
        console.log(sum(1));
      });`,
  });
});

test("modules that the test files mock", async () => {
  await expectCompiledToRunAsPlain(
    {
      ...app,
      "one.test.ts": `
      import { mock, test } from "bun:test";
      mock.module("./src/parts", () => ({ double: (n: number) => n + 1, triple: (n: number) => n + 2, unit: { name: "foot" }, level: 9 }));
      mock.module("node:path", () => ({ basename: () => "mocked" }));
      test("mocked", async () => {
        const { base, label, sum } = await import("./src/app");
        console.log(sum(10), label(), base("/a/b.txt"));
      });`,
      "two.test.ts": `
      import { test } from "bun:test";
      import { base, label, sum } from "./src/app";
      test("left alone in another file", () => { console.log(sum(10), label(), base("/a/b.txt")); });`,
    },
    "--isolate",
  );
});

test("a module object that a test file hands to a helper, gets from import() or from require()", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "helpers/stub.ts": `
      import { spyOn } from "bun:test";
      export function stub(object: any, name: string, value: unknown) { return spyOn(object, name).mockReturnValue(value); }`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as parts from "./src/parts";
      import { sum } from "./src/app";
      import { stub } from "./helpers/stub";
      test("handed on", () => {
        const spy = stub(parts, "double", 1000);
        console.log(sum(1));
        spy.mockRestore();
        console.log(sum(1));
      });`,
    "two.test.ts": `
      import { spyOn, test } from "bun:test";
      import { sum } from "./src/app";
      test("loaded", async () => {
        const parts = await import("./src/parts");
        const spy = spyOn(parts, "triple").mockReturnValue(5);
        console.log(sum(1));
        spy.mockRestore();
        const again = spyOn(require("./src/parts"), "double").mockReturnValue(6);
        console.log(sum(1));
        again.mockRestore();
        console.log(sum(1));
      });`,
  });
});

test("members of built-in objects, and names that they get", async () => {
  await expectCompiledToRunAsPlain(
    {
      ...app,
      "helpers/plant.ts": `
      function define(name: string) { Object.defineProperty(Object.prototype, name, { value: 1, enumerable: true, configurable: true }); }
      export function plant() { define("planted"); }
      export function plantUnder(name: string) { define(name); }`,
      "setup.ts": `(Function.prototype as any).marked = "by the preload";`,
      "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import fs from "node:fs";
      import { find, keysOf, size } from "./src/app";
      import { plant, plantUnder } from "./helpers/plant";
      test("replaced", () => {
        const spy = spyOn(String.prototype, "indexOf").mockReturnValue(42);
        console.log(find("abc", "c"), spy.mock.calls.length);
        spy.mockRestore();
        console.log(find("abc", "c"), (find as any).marked);
      });
      test("added", () => {
        (Object.prototype as any).polluted = 1;
        plant();
        plantUnder("named by the test");
        console.log(keysOf({ own: 1 }));
        delete (Object.prototype as any).polluted;
        delete (Object.prototype as any).planted;
        delete (Object.prototype as any)["named by the test"];
        console.log(keysOf({ own: 1 }));
      });`,
    },
    "--preload",
    "./setup.ts",
  );
});

// Packages are an image of their own, what else the test files share is a second one, and each test file a third.
test("a spy on a name that a file of the program exports again from a package, and on a CommonJS package", async () => {
  const others = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [
      `other${index}.test.ts`,
      `import { expect, test } from "bun:test";\nimport { run } from "./src/uses.js";\ntest("other", async () => { expect(await run()).toContain("real f"); });`,
    ]),
  );
  using dir = tempDir("what-tests-replace", {
    ...others,
    "tsconfig.json": "{}",
    "node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg", type: "module", main: "index.js" }),
    "node_modules/@scope/pkg/index.js": `export { f, g } from "./dist/sub/file.js";`,
    "node_modules/@scope/pkg/dist/sub/file.js": `
      export async function f(options = {}) { return "real f " + Object.keys(options).length; }
      export function g() { return "real g"; }`,
    "node_modules/cjs-pkg/package.json": JSON.stringify({ name: "cjs-pkg", main: "index.js" }),
    "node_modules/cjs-pkg/index.js": `"use strict";\nexports.add = function add(a, b) { return a + b; };`,
    "src/adapter.ts": `
      export { f, g } from "@scope/pkg/dist/sub/file.js";
      import { g as inner } from "@scope/pkg/dist/sub/file.js";
      export { inner as renamed };`,
    "src/uses.ts": `
      import { f, g, renamed } from "./adapter.js";
      import * as cjs from "cjs-pkg";
      export async function run() { return [await f({ x: 1 }), g(), renamed(), cjs.add(1, 2)].join(" | "); }`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import * as adapter from "./src/adapter.js";
      import * as cjs from "cjs-pkg";
      import { run } from "./src/uses.js";
      test("spied", async () => {
        console.log(await run());
        const first = spyOn(adapter, "f").mockImplementation(async () => "fake f");
        console.log(await run(), first.mock.calls.length);
        first.mockRestore();
        const second = spyOn(adapter, "renamed").mockReturnValue("fake g");
        const third = spyOn(cjs, "add").mockReturnValue(-1);
        console.log(await run(), second.mock.calls.length, third.mock.calls.length, cjs.add(1, 2));
        second.mockRestore();
        third.mockRestore();
        console.log(await run());
      });`,
  });
  const flags = ["--isolate", "--parallel=1", "one.test.ts", "other"];
  const inLayers = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  const plain = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
  const compiled = await run([bunExe(), "test", "--aot", ...flags], String(dir), inLayers);
  expect(plain.stdout).toContain("fake f | real g | real g | 3 1");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});

test("a spy on a name that a file of the program exports again from a module of Bun, written without node:", async () => {
  const others = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [
      `other${index}.test.ts`,
      `import { expect, test } from "bun:test";\nimport { under } from "./src/third.js";\ntest("other", () => { expect(under("a")).toBe("p 86f7e437 1"); });`,
    ]),
  );
  using dir = tempDir("what-tests-replace", {
    ...others,
    "tsconfig.json": "{}",
    "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", type: "module", main: "index.js" }),
    "node_modules/pkg/index.js": `export function p() { return "p"; }`,
    "src/barrel.ts": `
      import { createHash, randomBytes, randomUUID } from 'crypto'
      export { createHash, randomBytes, randomUUID }`,
    "src/reader.ts": `
      import { createHash, randomBytes } from "./barrel.js";
      import { p } from "pkg";
      export function digest(text: string) {
        return [p(), createHash("sha1").update(text).digest("hex").slice(0, 8), randomBytes(1).length].join(" ");
      }`,
    "src/third.ts": `
      import { digest } from "./reader.js";
      export function under(text: string) { return digest(text); }`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import os from "os";
      import * as barrel from "./src/barrel.js";
      import { under } from "./src/third.js";
      test("spied", () => {
        console.log(under("a"));
        {
          using spy = spyOn(barrel, "createHash");
          console.log(under("a"), spy.mock.calls.length, JSON.stringify(spy.mock.calls[0]));
        }
        const fake = spyOn(barrel, "randomBytes").mockImplementation((() => [1, 2, 3]) as any);
        console.log(under("a"), fake.mock.calls.length);
        fake.mockRestore();
        const host = spyOn(os, "hostname").mockReturnValue("fake host");
        console.log(os.hostname(), host.mock.calls.length);
        host.mockRestore();
        console.log(under("a"), os.hostname() === "fake host");
      });`,
  });
  const flags = ["--isolate", "--parallel=1", "one.test.ts", "other"];
  const inLayers = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  const plain = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
  const compiled = await run([bunExe(), "test", "--aot", ...flags], String(dir), inLayers);
  expect(plain.stdout).toContain('p 86f7e437 1 1 ["sha1"]\np 86f7e437 3 1\nfake host 1\np 86f7e437 1 false');
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
