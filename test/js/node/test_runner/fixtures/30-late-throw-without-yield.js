// node-test.test.ts runs this with `--timeout 50`. No body yields before it
// blocks past that timeout, so the timeout timer cannot run first.
const { test } = require("node:test");
const bunTest = require("bun:test");

const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);

test("throws", () => {
  block();
  throw new Error("thrown by the test");
});

test("returns", () => {
  block();
});

// node:test fails this test with an error of its own, so the test did not only return.
test("expectFailure returns", { expectFailure: true }, () => {
  block();
});

// node:test accepts this error and ends the test without one, so the test only returned.
test("expectFailure throws", { expectFailure: true }, () => {
  block();
  throw new Error("the expected failure");
});

// The error of a bun:test hook cannot fail a test that called t.skip(), so the timeout of the hook does.
bunTest.describe("t.skip(), then a bun:test hook throws", () => {
  bunTest.afterEach(() => {
    block();
    throw new Error("thrown by the hook");
  });
  test("test", t => {
    t.skip();
  });
});
