import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/28647
// assert.deepStrictEqual(new Proxy(['foo'], {}), ['foo']) should pass
// Node.js treats Proxies as transparent for deep equality

test("assert.deepStrictEqual with Proxy<Array> and Proxy<Object>", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const assert = require("node:assert");

      // Proxy<Array> vs Array
      assert.deepStrictEqual(new Proxy(["foo"], {}), ["foo"]);
      assert.deepStrictEqual(["foo"], new Proxy(["foo"], {}));
      assert.deepStrictEqual(new Proxy([1, 2, 3], {}), [1, 2, 3]);

      // Proxy<Object> vs Object
      assert.deepStrictEqual(new Proxy({ a: 1 }, {}), { a: 1 });
      assert.deepStrictEqual({ a: 1 }, new Proxy({ a: 1 }, {}));
      assert.deepStrictEqual(new Proxy({ a: 1, b: 2 }, {}), { a: 1, b: 2 });

      // Proxy vs Proxy
      assert.deepStrictEqual(new Proxy([1, 2], {}), new Proxy([1, 2], {}));
      assert.deepStrictEqual(new Proxy({ x: 1 }, {}), new Proxy({ x: 1 }, {}));

      // Proxy<Array> vs different Array should still fail
      assert.throws(() => {
        assert.deepStrictEqual(new Proxy([1, 2], {}), [1, 2, 3]);
      });

      // Proxy<Object> vs different Object should still fail
      assert.throws(() => {
        assert.deepStrictEqual(new Proxy({ a: 1 }, {}), { a: 2 });
      });

      // Proxy<Object> vs Object with different keys should still fail
      assert.throws(() => {
        assert.deepStrictEqual(new Proxy({ a: 1 }, {}), { b: 1 });
      });

      console.log("pass");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("pass\n");
  expect(exitCode).toBe(0);
});

test("Bun.deepEquals with Proxy (strict mode)", () => {
  // Proxy<Array>
  expect(Bun.deepEquals(new Proxy([1, 2, 3], {}), [1, 2, 3], true)).toBe(true);
  expect(Bun.deepEquals([1, 2, 3], new Proxy([1, 2, 3], {}), true)).toBe(true);

  // Proxy<Object>
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { a: 1 }, true)).toBe(true);
  expect(Bun.deepEquals({ a: 1 }, new Proxy({ a: 1 }, {}), true)).toBe(true);

  // Different values should still fail
  expect(Bun.deepEquals(new Proxy([1, 2], {}), [1, 2, 3], true)).toBe(false);
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { a: 2 }, true)).toBe(false);
  expect(Bun.deepEquals(new Proxy({ a: 1 }, {}), { b: 1 }, true)).toBe(false);
});
