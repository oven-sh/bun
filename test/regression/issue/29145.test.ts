import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";

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
 */
describe("RedisClient: assigning null to onclose/onconnect (#29145)", () => {
  test("onclose = null does not panic on close()", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onclose = null;
    expect(() => c.close()).not.toThrow();
  });

  test("onconnect = null does not panic on close()", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onconnect = null;
    expect(() => c.close()).not.toThrow();
  });

  test("onclose = undefined is also accepted", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onclose = undefined as any;
    expect(() => c.close()).not.toThrow();
  });

  test("onconnect = undefined is also accepted", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onconnect = undefined as any;
    expect(() => c.close()).not.toThrow();
  });

  test("reading onclose after assigning null returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onclose = null;
    expect(c.onclose).toBeUndefined();
    c.close();
  });

  test("reading onconnect after assigning null returns undefined", () => {
    const c = new RedisClient("redis://localhost:6379");
    c.onconnect = null;
    expect(c.onconnect).toBeUndefined();
    c.close();
  });

  test("assigning a function to onclose still works", () => {
    const c = new RedisClient("redis://localhost:6379");
    const handler = () => {};
    c.onclose = handler;
    expect(c.onclose).toBe(handler);
    c.close();
  });

  test("assigning a function to onconnect still works", () => {
    const c = new RedisClient("redis://localhost:6379");
    const handler = () => {};
    c.onconnect = handler;
    expect(c.onconnect).toBe(handler);
    c.close();
  });

  test("assigning a non-callable non-null value to onclose throws TypeError", () => {
    const c = new RedisClient("redis://localhost:6379");
    expect(() => {
      (c as any).onclose = "not a function";
    }).toThrow(TypeError);
    expect(() => {
      (c as any).onclose = 42;
    }).toThrow(TypeError);
    expect(() => {
      (c as any).onclose = {};
    }).toThrow(TypeError);
    c.close();
  });

  test("assigning a non-callable non-null value to onconnect throws TypeError", () => {
    const c = new RedisClient("redis://localhost:6379");
    expect(() => {
      (c as any).onconnect = "not a function";
    }).toThrow(TypeError);
    expect(() => {
      (c as any).onconnect = 42;
    }).toThrow(TypeError);
    expect(() => {
      (c as any).onconnect = {};
    }).toThrow(TypeError);
    c.close();
  });

  test("null onclose while an in-flight connection is being torn down does not panic", async () => {
    // This reproduces the original bug's exact shape: obtain an in-flight
    // connection, detach via `null`, and close. Before the fix, the close path
    // invoked `.call(...)` on the cached `null`, triggering a TypeError that
    // was cleared during teardown.
    const c = new RedisClient("redis://localhost:6379");
    try {
      // Touch the connection so the client transitions through states that
      // exercise the onclose callback path. If the server isn't reachable we
      // just swallow the rejection — the bug fires regardless of whether the
      // command succeeds.
      await c.set("test:issue-29145", "v", "EX", "10").catch(() => {});
    } finally {
      c.onclose = null;
      expect(() => c.close()).not.toThrow();
    }
  });
});
