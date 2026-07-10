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

test("__esModule is settable", () => {
  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  expect(Object.hasOwn(Self, "__esModule")).toBe(true);
  Self.__esModule = false;
  expect(Self.__esModule).toBe(undefined);
  expect(Object.hasOwn(Self, "__esModule")).toBe(false);
  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  Self.__esModule = undefined;
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

test("require(esm) defines __esModule as an own enumerable property", async () => {
  using dir = tempDir("require-esm-esmodule", {
    "e.mjs": "export default { d: 1 };\nexport const x = 7;\n",
    "sorted.mjs": "export default 1; export const Alpha = 1; export const zzz = 2; export const _a = 3;\n",
    "noDefault.mjs": "export const x = 1;\n",
    "hasEsm.mjs": "export const __esModule = 'user-set'; export default 1;\n",
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

// module that explicitly exports __esModule keeps the user's value
const h = require("./hasEsm.mjs");
assert.strictEqual(h.__esModule, "user-set");
assert.strictEqual(Object.hasOwn(h, "__esModule"), true);

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
