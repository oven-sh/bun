import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Top-level `await import(self)` is a spec-level deadlock under the new
// pure-C++ module loader (Node prints an "unsettled top-level await" warning
// and exits). A static self-import yields the same namespace object without
// blocking evaluation on itself.
import * as Self from "./esModule.test.ts";

test("__esModule defaults to undefined", () => {
  expect(Self.__esModule).toBeUndefined();
  expect("__esModule" in Self).toBe(false);
  expect(Reflect.has(Self, "__esModule")).toBe(false);
});

test("assigning __esModule to a non-extensible namespace throws like Node", () => {
  // A namespace created by `import` is the spec's non-extensible exotic
  // object, so the marker cannot be added to it. Node throws the same way.
  expect(() => {
    // @ts-expect-error intentional write to a namespace object
    Self.__esModule = true;
  }).toThrow(TypeError);
  expect(Self.__esModule).toBeUndefined();
  expect("__esModule" in Self).toBe(false);
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

// https://github.com/oven-sh/bun/issues/39866
test.concurrent("'__esModule' in an ES module namespace is false", async () => {
  using dir = tempDir("esmodule-in-namespace", {
    "inner.mjs": "export const alpha = 1;\nexport const beta = 2;\n",
    // The export shape of zod/index.js: a star re-export next to explicit exports.
    "dep.mjs": 'import * as ns from "./inner.mjs";\nexport * from "./inner.mjs";\nexport { ns };\nexport default ns;\n',
    "main.mjs": `
import * as mod from "./dep.mjs";
if ("__esModule" in mod) throw new Error("'__esModule' in mod must be false");
if (Reflect.has(mod, "__esModule")) throw new Error("Reflect.has(mod, '__esModule') must be false");
if (Object.hasOwn(mod, "__esModule")) throw new Error("Object.hasOwn(mod, '__esModule') must be false");

// vitest's interopModule heuristic: a truthy '"__esModule" in mod.default'
// replaces the module with its default export and drops the explicit exports.
let m = mod;
const defaultExport = "default" in m ? m.default : m;
if (defaultExport !== null && typeof defaultExport === "object" && "__esModule" in defaultExport) {
  m = defaultExport;
}
console.log(Object.keys(m).sort().join(","));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("alpha,beta,default,ns\n");
  expect(exitCode).toBe(0);
});

test.concurrent("require(esm) sets __esModule as an own property when a default export exists", async () => {
  using dir = tempDir("require-esm-esmodule", {
    "e.mjs": "export default { d: 1 };\nexport const x = 7;\n",
    "noDefault.mjs": "export const x = 1;\n",
    "hasEsm.mjs": "export const __esModule = 'user-set';\nexport default 1;\n",
    "p.cjs": `
const assert = require("node:assert");

const n = require("./e.mjs");
assert.strictEqual(n.__esModule, true);
assert.strictEqual(Object.hasOwn(n, "__esModule"), true);
assert.strictEqual(({ ...n }).__esModule, true);
assert.strictEqual(Object.assign({}, n).__esModule, true);
assert.strictEqual(Object.getPrototypeOf(n), null);

// No default export: no __esModule marker (matches Node).
const nd = require("./noDefault.mjs");
assert.strictEqual(nd.__esModule, undefined);
assert.strictEqual("__esModule" in nd, false);
assert.strictEqual(Object.getPrototypeOf(nd), null);

// A module that exports __esModule itself keeps the user's value.
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
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
