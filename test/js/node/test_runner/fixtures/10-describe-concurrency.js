const { describe, test } = require("node:test");
const assert = require("node:assert");

// Passes only if `n` sibling bodies are in flight at once, so it fails when
// the suite runs serially.
function makeConcurrentBody(n) {
  let started = 0;
  return async () => {
    started++;
    for (let i = 0; i < 100 && started < n; i++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.strictEqual(started, n);
  };
}

// Fails if any sibling body starts while this one is suspended, so it fails
// when the suite runs concurrently.
function makeSerialBody() {
  let inFlight = 0;
  return async () => {
    inFlight++;
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(inFlight, 1);
    inFlight--;
  };
}

// `concurrency: N >= 2` runs the suite's tests in parallel.
describe("concurrency number", { concurrency: 3 }, () => {
  const body = makeConcurrentBody(3);
  test("a", body);
  test("b", body);
  test("c", body);

  // `concurrency: 1` overrides the concurrent parent.
  describe("nested serial (1)", { concurrency: 1 }, () => {
    const body = makeSerialBody();
    test("s1", body);
    test("s2", body);
  });
});

// `concurrency: true` behaves like an unbounded limit.
describe("concurrency true", { concurrency: true }, () => {
  const body = makeConcurrentBody(2);
  test("t1", body);
  test("t2", body);

  // `concurrency: false` is the other spelling of serial.
  describe("nested serial (false)", { concurrency: false }, () => {
    const body = makeSerialBody();
    test("f1", body);
    test("f2", body);
  });
});

// An unset `concurrency` inherits from the parent suite.
describe("inherit parent", { concurrency: true }, () => {
  describe("nested unset", () => {
    const body = makeConcurrentBody(2);
    test("i1", body);
    test("i2", body);
  });
});

// `concurrency: null` means unspecified, exactly like `undefined`: it
// inherits from the parent and is not rejected by validation.
describe("null parent", { concurrency: true }, () => {
  describe("nested null", { concurrency: null }, () => {
    const body = makeConcurrentBody(2);
    test("n1", body);
    test("n2", body);
  });
});
