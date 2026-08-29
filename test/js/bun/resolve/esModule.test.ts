import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Top-level `await import(self)` is a spec-level deadlock under the new
// pure-C++ module loader (Node prints an "unsettled top-level await" warning
// and exits). A static self-import yields the same namespace object without
// blocking evaluation on itself.
import * as Self from "./esModule.test.ts";

test("__esModule defaults to undefined", () => {
  expect(Self.__esModule).toBeUndefined();
});

test("require of self does not set __esModule without a default export", () => {
  expect(Self.__esModule).toBeUndefined();
  {
    const Self = require("./esModule.test.ts");
    expect(Self.__esModule).toBeUndefined();
  }
  expect(Self.__esModule).toBeUndefined();
  expect(Object.getOwnPropertyNames(Self)).toBeEmpty();
});

// Runs after the tests above because the marker cannot be removed again.
test("__esModule can be set, and then behaves like a non-configurable own property", () => {
  expect(() => {
    Self.__esModule = false;
  }).toThrow(TypeError);
  expect(Object.hasOwn(Self, "__esModule")).toBe(false);

  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  expect(Object.getOwnPropertyDescriptor(Self, "__esModule")).toEqual({
    value: true,
    writable: true,
    enumerable: true,
    configurable: false,
  });
  expect(Object.getOwnPropertyNames(Self)).toEqual(["__esModule"]);

  expect(() => {
    Self.__esModule = false;
  }).toThrow(TypeError);
  expect(() => {
    delete Self.__esModule;
  }).toThrow(TypeError);
  expect(() => Object.defineProperty(Self, "__esModule", { value: false })).toThrow(TypeError);
  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  expect(Object.hasOwn(Self, "__esModule")).toBe(true);
});

test("require(esm) defines __esModule as an own enumerable property", async () => {
  using dir = tempDir("require-esm-esmodule", {
    "e.mjs": "export default { d: 1 };\nexport const x = 7;\n",
    "sorted.mjs": "export default 1; export const Alpha = 1; export const zzz = 2; export const _a = 3;\n",
    "noDefault.mjs": "export const x = 1;\n",
    "hasEsm.mjs": "export const __esModule = 'user-set'; export default 1;\n",
    "hasUndefinedEsm.mjs": "export const __esModule = undefined; export default 1;\n",
    "p.cjs": `
const assert = require("node:assert");

const n = require("./e.mjs");
assert.deepStrictEqual(Object.getOwnPropertyNames(n).sort(), ["__esModule", "default", "x"]);
assert.strictEqual(n.__esModule, true);
assert.strictEqual(Object.hasOwn(n, "__esModule"), true);
assert.strictEqual(({ ...n }).__esModule, true);
assert.strictEqual(Object.assign({}, n).__esModule, true);
assert.strictEqual(JSON.parse(JSON.stringify(n)).__esModule, true);
assert.strictEqual(Object.getPrototypeOf(n), null);
assert.deepStrictEqual(Object.getOwnPropertyDescriptor(n, "__esModule"), {
  value: true, writable: true, enumerable: true, configurable: false,
});

// sort order matches Node (code-point sort with __esModule interleaved)
const s = require("./sorted.mjs");
assert.deepStrictEqual(Object.getOwnPropertyNames(s), ["Alpha", "__esModule", "_a", "default", "zzz"]);
assert.deepStrictEqual(Object.keys(s), ["Alpha", "__esModule", "_a", "default", "zzz"]);

// no default export -> no __esModule marker (matches Node)
const nd = require("./noDefault.mjs");
assert.deepStrictEqual(Object.getOwnPropertyNames(nd), ["x"]);
assert.strictEqual(nd.__esModule, undefined);
assert.strictEqual(Object.getPrototypeOf(nd), null);

// module that explicitly exports __esModule keeps the user's value, even undefined
const h = require("./hasEsm.mjs");
assert.strictEqual(h.__esModule, "user-set");
assert.strictEqual(Object.hasOwn(h, "__esModule"), true);
const hu = require("./hasUndefinedEsm.mjs");
assert.strictEqual(hu.__esModule, undefined);
assert.deepStrictEqual(Object.getOwnPropertyNames(hu), ["__esModule", "default"]);
assert.deepStrictEqual(Object.getOwnPropertyDescriptor(hu, "__esModule"), {
  value: undefined, writable: true, enumerable: true, configurable: false,
});

console.log("ok");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "p.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("require(esm) still defines __esModule when import() materialized the namespace first", async () => {
  using dir = tempDir("require-esm-esmodule-order", {
    "e.mjs": "export default { d: 1 };\n",
    "entry.mjs": `
import assert from "node:assert";
import { createRequire } from "node:module";

const ns = await import("./e.mjs");
assert.deepStrictEqual(Object.keys(ns), ["default"]);

const n = createRequire(import.meta.url)("./e.mjs");
assert.strictEqual(n.__esModule, true);
assert.strictEqual(Object.hasOwn(n, "__esModule"), true);
assert.deepStrictEqual(Object.keys(n), ["__esModule", "default"]);
assert.strictEqual(({ ...n }).__esModule, true);

console.log("ok");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
