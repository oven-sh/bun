import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

// When a test or hook is registered while an AsyncLocalStorage context is
// active, bun:test wraps the callback in an AsyncContextFrame so the context
// is restored at call time. The wrapper has no `.length` and is not itself
// callable via JSC::getCallData, so `.length` (done-param detection) and
// `.bind()` (test.each) must be read from the user's function before wrapping.

const als = new AsyncLocalStorage<{ tag: string }>();
const order: string[] = [];
const mark = (label: string) => order.push(`${label}:${als.getStore()?.tag ?? "none"}`);

describe("registered inside an active ALS context", () => {
  als.run({ tag: "ctx" }, () => {
    beforeAll(function zeroArg() {
      mark("beforeAll");
    });
    beforeEach(function zeroArg() {
      mark("beforeEach");
    });
    afterEach(function zeroArg() {
      mark("afterEach");
    });
    afterAll(function zeroArg() {
      mark("afterAll");
    });
    afterAll(function withDone(done) {
      mark("afterAll-done");
      setImmediate(done);
    });

    test("zero-arg test", function zeroArg() {
      mark("zero-arg test");
    });

    test("one-arg test still receives done", function withDone(done) {
      mark("done test");
      expect(typeof done).toBe("function");
      setImmediate(done);
    });

    test.each([[1], [2]])("each %p", function withArg(n) {
      mark(`each ${n}`);
    });

    describe("nested describe", function zeroArg() {
      mark("nested.body");
      afterAll(function zeroArg() {
        mark("nested.afterAll");
      });
      test("passes", function zeroArg() {
        mark("nested.test");
      });
    });
  });
});

test("hooks and tests registered inside an ALS context use the callback's real arity and restore the context", () => {
  // Every entry ran inside the restored `{ tag: "ctx" }` store, in order.
  expect(order).toEqual([
    "nested.body:ctx",
    "beforeAll:ctx",
    "beforeEach:ctx",
    "zero-arg test:ctx",
    "afterEach:ctx",
    "beforeEach:ctx",
    "done test:ctx",
    "afterEach:ctx",
    "beforeEach:ctx",
    "each 1:ctx",
    "afterEach:ctx",
    "beforeEach:ctx",
    "each 2:ctx",
    "afterEach:ctx",
    "beforeEach:ctx",
    "nested.test:ctx",
    "afterEach:ctx",
    "nested.afterAll:ctx",
    "afterAll:ctx",
    "afterAll-done:ctx",
  ]);
});
