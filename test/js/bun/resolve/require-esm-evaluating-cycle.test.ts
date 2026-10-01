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
