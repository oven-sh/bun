const { describe, test } = require("node:test");
const assert = require("node:assert");

// `concurrency: N >= 2` must run the suite's tests in parallel: all three
// bodies have to be in flight at once before any can finish its loop.
describe("concurrency number", { concurrency: 3 }, () => {
  let started = 0;
  const concurrentBody = async () => {
    started++;
    for (let i = 0; i < 100 && started < 3; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.strictEqual(started, 3);
  };
  test("a", concurrentBody);
  test("b", concurrentBody);
  test("c", concurrentBody);

  // `concurrency: 1` overrides the concurrent parent: no sibling may start
  // while a body is suspended, so every body must observe itself alone.
  describe("nested serial (1)", { concurrency: 1 }, () => {
    let inFlight = 0;
    const serialBody = async () => {
      inFlight++;
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(inFlight, 1);
      inFlight--;
    };
    test("s1", serialBody);
    test("s2", serialBody);
  });
});

// `concurrency: true` behaves like an unbounded limit.
describe("concurrency true", { concurrency: true }, () => {
  let started = 0;
  const concurrentBody = async () => {
    started++;
    for (let i = 0; i < 100 && started < 2; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.strictEqual(started, 2);
  };
  test("t1", concurrentBody);
  test("t2", concurrentBody);

  // `concurrency: false` is the other spelling of serial.
  describe("nested serial (false)", { concurrency: false }, () => {
    let inFlight = 0;
    const serialBody = async () => {
      inFlight++;
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(inFlight, 1);
      inFlight--;
    };
    test("f1", serialBody);
    test("f2", serialBody);
  });
});
