/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * Node.js formats an export of a namespace object inside one try and prints
 * <uninitialized> for a ReferenceError, whichever step throws it:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/inspect.js#L2268-L2291
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { format, inspect } from "node:util";
import { SourceTextModule } from "node:vm";
import { thrown as thrownForUninitializedToString } from "./namespace-with-uninitialized-toString-fixture.mjs";

const throwsReferenceError = `{ [Symbol.for("nodejs.util.inspect.custom")]() { throw new ReferenceError("from the custom inspect function"); } }`;
const importSource = source => import("data:text/javascript," + encodeURIComponent(source));

test("an export of a vm.SourceTextModule whose custom inspect function throws a ReferenceError", async () => {
  const module = new SourceTextModule(`export const x = ${throwsReferenceError}; export const y = 1;`);
  await module.link(() => 0);
  await module.evaluate();
  assert.strictEqual(inspect(module.namespace), "[Module: null prototype] { x: <uninitialized>, y: 1 }");
});

test("the same export of an imported module", async () => {
  const ns = await importSource(`export const x = ${throwsReferenceError}; export const y = 1;`);
  assert.match(inspect(ns, { breakLength: Infinity }), /\{ x: <uninitialized>, y: 1 \}$/);
});

test("an export named constructor does not name the namespace object", async () => {
  const ns = await importSource(`export function constructor() {}`);
  // Node.js prints "[Module: null prototype] { constructor: [Function: constructor] }".
  assert.match(inspect(ns, { breakLength: Infinity }), /^\[?Module\b.* \{ constructor: \[Function: constructor\] \}$/);
});

test("format() with %s calls an export named toString, and prints a namespace object that has none", async () => {
  const withToString = await importSource(`export function toString() { return "from the export"; }`);
  assert.strictEqual(format("%s", withToString), "from the export");
  const without = await importSource(`export const y = 1;`);
  assert.match(format("%s", without), /\{ y: 1 \}$/);
});

test("format() with %s throws the error of a toString that it cannot read", () => {
  const value = {
    get toString() {
      throw new Error("from the toString getter");
    },
  };
  assert.throws(() => format("%s", value), { name: "Error", message: "from the toString getter" });
  assert.strictEqual(thrownForUninitializedToString?.name, "ReferenceError");
});

test("a constructor getter that throws does not make inspect throw", () => {
  const prototype = Object.create(null, {
    constructor: {
      get() {
        throw new Error("from the constructor getter");
      },
    },
  });
  assert.strictEqual(inspect(Object.create(prototype)), "Object <[Object: null prototype] {}> {}");
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // An older Node.js does not parse the `await using` below.
  const node = nodeExeAtLeast("24.0.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node, "--experimental-vm-modules", "--no-warnings", fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
