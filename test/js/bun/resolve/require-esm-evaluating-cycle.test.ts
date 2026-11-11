// require(esm) of a module that is still evaluating — the require() sits
// inside that module's own evaluation (a.mjs → require(b.mjs) → b imports
// a.mjs). The namespace is live: hoisted functions and already-initialized
// bindings are visible, later `const`s are in TDZ. Code-split bundler
// output (target bun) relies on this for require() cycles across chunks.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) inside a require cycle returns the live namespace, not an empty placeholder", async () => {
  using dir = tempDir("require-esm-evaluating-cycle", {
    "a.mjs": `
      export function hoisted() { return "h" }
      export const before = "before"
      const b = require("./b.mjs")
      const self = require("./a.mjs")
      console.log(JSON.stringify({
        fromB: b.fromB(),
        selfHoisted: typeof self.hoisted,
        selfBefore: self.before,
        selfLaterTdz: (() => { try { return self.later } catch (e) { return e.constructor.name } })(),
      }))
      export const later = "later"
    `,
    "b.mjs": `
      import { hoisted, before } from "./a.mjs"
      export function fromB() { return hoisted() + ":" + before }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    fromB: "h:before",
    selfHoisted: "function",
    selfBefore: "before",
    selfLaterTdz: "ReferenceError",
  });
  expect(exitCode).toBe(0);
});

// The CommonJS side reads `__esModule` / `"module.exports"` off that live
// namespace; when the module happens to export a binding by that name that is
// still in TDZ, require() itself must not throw (reading it afterwards does).
test("require(esm) inside a require cycle tolerates a TDZ `__esModule` export", async () => {
  using dir = tempDir("require-esm-evaluating-cycle-tdz", {
    "a.mjs": `
      const self = require("./a.mjs")
      const read = (() => { try { return self.__esModule } catch (e) { return e.constructor.name } })()
      console.log(typeof self, read)
      export let __esModule = true
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "a.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("object ReferenceError");
  expect(exitCode).toBe(0);
});

// A CommonJS file requires a module whose load an outer require() has begun. What is left of that load waits in the queue of the outer one.
test.concurrent.each([
  {
    name: "the module imports nothing",
    files: {
      "main.mjs": `import * as bridge from "./bridge.cjs"; import { label } from "./tool.cjs"; console.log(bridge.default.panel, label);`,
      "bridge.cjs": `exports.panel = require("./panel.mjs").panel;`,
      "panel.mjs": `import { shade } from "./shades.mjs"; import { color } from "./colors.mjs"; export const panel = [shade, color].join();`,
      "shades.mjs": `import * as colors from "./colors.mjs"; import * as tool from "./tool.cjs"; export const shade = colors.color + "+" + tool.label;`,
      "tool.cjs": `exports.label = "tool of " + require("./colors.mjs").color;`,
      "colors.mjs": `export const color = "red";`,
    },
    stdout: "red+tool of red,red tool of red",
  },
  {
    name: "two required graphs import the module",
    files: {
      "main.mjs": `import { createRequire } from "node:module"; createRequire(import.meta.url)("./hub.mjs");`,
      "hub.mjs": `import { leaf } from "./leaf.mjs"; import older from "./older.cjs"; console.log(leaf, older);`,
      "older.cjs": `module.exports = require("./bridge.mjs").bridge;`,
      "bridge.mjs": `import * as fs from "node:fs"; import helper from "./helper.cjs"; import { leaf } from "./leaf.mjs"; export const bridge = helper + " " + leaf + " " + typeof fs;`,
      "helper.cjs": `try { module.exports = require("./leaf.mjs").leaf; } catch (error) { module.exports = error.message; }`,
      "leaf.mjs": `import * as fs from "node:fs"; export const leaf = "leaf:" + typeof fs;`,
    },
    stdout: "leaf:object leaf:object leaf:object object",
  },
  {
    name: "the module awaits",
    files: {
      "main.mjs": `import { createRequire } from "node:module"; try { createRequire(import.meta.url)("./hub.mjs"); } catch (error) { console.log(error.message.includes("async module")); }`,
      "hub.mjs": `import older from "./older.cjs"; import { leaf } from "./leaf.mjs"; export { leaf, older };`,
      "older.cjs": `try { module.exports = require("./leaf.mjs").leaf; } catch (error) { module.exports = console.log(error.message.includes("async module")); }`,
      "leaf.mjs": `await 0; export const leaf = "leaf";`,
    },
    stdout: "true\ntrue",
  },
])("require(esm) inside a graph that a require() loads: $name", async ({ files, stdout }) => {
  using dir = tempDir("require-esm-nested", files as unknown as Record<string, string>);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const result = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(result).toEqual([stdout + "\n", "", 0]);
});
