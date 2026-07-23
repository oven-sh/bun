import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

// When a test or hook is registered while an AsyncLocalStorage context is
// active, bun:test wraps the callback in an AsyncContextFrame so the context
// is restored at call time. Done-param detection must read the arity of the
// *user* function, not the wrapper (which has no `.length`), otherwise every
// zero-arg callback waits for a done() that never comes and times out.

const als = new AsyncLocalStorage<{ tag: string }>();
const order: string[] = [];

describe("registered inside an active ALS context", () => {
  als.run({ tag: "collection" }, () => {
    beforeAll(function zeroArg() {
      order.push("beforeAll");
    });
    beforeEach(function zeroArg() {
      order.push("beforeEach");
    });
    afterEach(function zeroArg() {
      order.push("afterEach");
    });
    afterAll(function zeroArg() {
      order.push("afterAll");
    });
    afterAll(function withDone(done) {
      order.push("afterAll-done");
      setImmediate(done);
    });

    test("zero-arg test", function zeroArg() {
      order.push("zero-arg test");
      expect(als.getStore()?.tag).toBe("collection");
    });

    test("one-arg test still receives done", function withDone(done) {
      order.push("done test");
      expect(typeof done).toBe("function");
      expect(als.getStore()?.tag).toBe("collection");
      setImmediate(done);
    });

    describe("nested describe", function zeroArg() {
      afterAll(function zeroArg() {
        order.push("nested.afterAll");
      });
      test("passes", function zeroArg() {
        order.push("nested.test");
      });
    });
  });
});

test("hooks and tests registered inside an ALS context use the callback's real arity", () => {
  expect(order).toEqual([
    "beforeAll",
    "beforeEach",
    "zero-arg test",
    "afterEach",
    "beforeEach",
    "done test",
    "afterEach",
    "beforeEach",
    "nested.test",
    "afterEach",
    "nested.afterAll",
    "afterAll",
    "afterAll-done",
  ]);
});
