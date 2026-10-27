/**
 * util.styleText() and util.inspect() tested a value with a check that is true
 * only for a plain array object. Node uses `ArrayIsArray`, which is also true
 * for a Proxy whose target is an array and for `Array.prototype`:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/util.js#L286 (styleText, format)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/inspect.js#L1253 (inspect, value)
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * Node.js, which is where the expected values come from. It cannot import from
 * "harness" at the top for the same reason.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect, styleText } from "node:util";

const isBun = process.versions.bun !== undefined;

function proxied<T extends object>(target: T): T {
  return new Proxy(target, {});
}

describe("util.styleText()", () => {
  const options = { validateStream: false };

  test("takes a Proxy of an array as the list of formats", () => {
    const styled = "\u001b[31m\u001b[1mtext\u001b[22m\u001b[39m";
    assert.strictEqual(styleText(["red", "bold"], "text", options), styled);
    assert.strictEqual(styleText(proxied(["red", "bold"]), "text", options), styled);
    assert.strictEqual(styleText(proxied(proxied(["red", "bold"])), "text", options), styled);
  });

  test("throws the TypeError of Array.isArray() for a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable(["red"], {});
    revoke();
    // Node: "Cannot perform 'IsArray' on a proxy that has been revoked".
    assert.throws(() => styleText(proxy, "text", options), { name: "TypeError", message: /IsArray|Array\.isArray/ });
  });
});

describe("util.inspect()", () => {
  test("prints Array.prototype as an array", () => {
    assert.strictEqual(inspect(Array.prototype), "Object(0) []");
    assert.strictEqual(inspect([Array.prototype]), "[ Object(0) [] ]");
  });

  test("prints a Proxy of a Proxy of an array as an array", () => {
    // Node v26 prints one `Proxy(` wrapper for each level. Bun does not print the wrapper (#38652 adds it).
    const expected = isBun ? "[ 1, 2 ]" : "Proxy(Proxy([ 1, 2 ]))";
    assert.strictEqual(inspect(proxied(proxied([1, 2]))), expected);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The expected values above are those of v26.3.0.
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
