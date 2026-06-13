import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { isDebug } from "harness";

/**
 * Regression test for issue #29145: `c.onclose = null` panics during `close()`
 *
 * The RedisClient `onclose`/`onconnect` setters cached whatever JS value was
 * assigned (including `null`), and the teardown path invoked `.call(...)` on
 * the cached value unconditionally, throwing a TypeError that was then
 * cleared during teardown and surfaced as:
 *
 *   panic(main thread): A JavaScript exception was thrown, but it was
 *   cleared before it could be read.
 *
 * The type definitions document `((...)=>void) | null` as the type for both
 * properties, so assigning `null` must be a supported way to detach the
 * handler.
 *
 * The tests are split into two blocks:
 *
 * - Behavior tests (setter validation, getter readback, function storage)
 *   run on every lane. A release regression in the setter/getter contract
 *   still fails visibly.
 * - Panic tests run only on debug/ASAN builds. The cleared-exception
 *   assertion that made this bug observable only fires under ASAN; on
 *   release builds the TypeError is silently swallowed during teardown
 *   and the no-throw assertion would pass even on the buggy code, so
 *   gating them prevents false greens.
 */
describe("RedisClient: onclose/onconnect setter/getter contract (#29145)", () => {
  test("reading onclose after assigning null returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      c.onclose = null;
      expect(c.onclose).toBeUndefined();
    } finally {
      c.close();
    }
  });

  test("reading onconnect after assigning null returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      c.onconnect = null;
      expect(c.onconnect).toBeUndefined();
    } finally {
      c.close();
    }
  });

  test("reading onclose after assigning undefined returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      c.onclose = undefined;
      expect(c.onclose).toBeUndefined();
    } finally {
      c.close();
    }
  });

  test("reading onconnect after assigning undefined returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      c.onconnect = undefined;
      expect(c.onconnect).toBeUndefined();
    } finally {
      c.close();
    }
  });

  test("assigning a function to onclose still works", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      const handler = () => {};
      c.onclose = handler;
      expect(c.onclose).toBe(handler);
    } finally {
      c.close();
    }
  });

  test("assigning a function to onconnect still works", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      const handler = () => {};
      c.onconnect = handler;
      expect(c.onconnect).toBe(handler);
    } finally {
      c.close();
    }
  });

  test("assigning a non-callable non-null value to onclose throws TypeError", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      expect(() => {
        (c as any).onclose = "not a function";
      }).toThrow(TypeError);
      expect(() => {
        (c as any).onclose = 42;
      }).toThrow(TypeError);
      expect(() => {
        (c as any).onclose = {};
      }).toThrow(TypeError);
    } finally {
      c.close();
    }
  });

  test("assigning a non-callable non-null value to onconnect throws TypeError", () => {
    const c = new RedisClient("redis://localhost:6379");
    try {
      expect(() => {
        (c as any).onconnect = "not a function";
      }).toThrow(TypeError);
      expect(() => {
        (c as any).onconnect = 42;
      }).toThrow(TypeError);
      expect(() => {
        (c as any).onconnect = {};
      }).toThrow(TypeError);
    } finally {
      c.close();
    }
  });
});

describe.skipIf(!isDebug)("RedisClient: no panic on null detach during teardown (#29145)", () => {
  test("null onclose while a connection is being torn down does not panic", async () => {
    // Reproduces the original bug by forcing the teardown path:
    //
    //   1. Point the client at a guaranteed-refused local port (127.0.0.1:1)
    //      so no external Redis is required and the test is self-contained.
    //   2. Issue a command to make the client connect; the connect fails with
    //      "Connection closed", which drives the socket close handler and
    //      fires the `onclose` callback path.
    //   3. Detach the handler via `null` before the final `close()` so the
    //      cached slot is empty during teardown.
    //
    // Before the fix, the teardown path invoked `.call(...)` on the cached
    // `null`, producing a TypeError that was cleared during close and
    // surfaced as `A JavaScript exception was thrown, but it was cleared
    // before it could be read.`
    const c = new RedisClient("redis://127.0.0.1:1", {
      autoReconnect: false,
      connectionTimeout: 500,
    });
    try {
      c.onclose = null;
      await c.set("test:issue-29145", "v", "EX", 10).catch(() => {});
      expect(() => c.close()).not.toThrow();
    } finally {
      c.close();
    }
  });
});
