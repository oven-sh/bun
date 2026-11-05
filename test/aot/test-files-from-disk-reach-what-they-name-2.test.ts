import { expect } from "bun:test";
import { tempDir } from "harness";
import { fromDisk, runTests, sources } from "./harness/test-files-from-disk-reach-what-they-name";
import { test } from "./supported";

// One of four files. Each case builds a project of its own: all in one took longer than CI gives a file under ASAN.

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
