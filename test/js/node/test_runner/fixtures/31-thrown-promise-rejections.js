// A promise that a test throws is the error of that test. Its rejection fails no other test,
// and the test does not wait for it. Node v26.3.0 gives the same verdict for each test.
const assert = require("node:assert");
const { test, describe, it, beforeEach, afterEach, after } = require("node:test");

const rejected = () => Promise.reject(new Error("the reason of a thrown promise"));
const nextImmediate = () => new Promise(resolve => setImmediate(resolve));
// Node gives a hook an ERR_TEST_FAILURE. Its cause is the value that the test threw.
const thrownValue = error => (error?.code === "ERR_TEST_FAILURE" && "cause" in error ? error.cause : error);

test("throws a rejected promise", () => {
  throw rejected();
});

test("has a subtest that throws a rejected promise, and then waits", async t => {
  await t.test("subtest", () => {
    throw rejected();
  });
  await nextImmediate();
});

test("passes after the test whose subtest threw a rejected promise", async () => {
  await nextImmediate();
});

let rejectThrownPromise;
test("throws a pending promise", () => {
  throw new Promise((resolve, reject) => (rejectThrownPromise = reject));
});

test("passes while it rejects the promise that the test before it threw", async () => {
  rejectThrownPromise(new Error("the late reason of a thrown promise"));
  await nextImmediate();
});

test("has a subtest that throws a pending promise, rejects that promise, and then waits", async t => {
  let rejectPromiseOfSubtest;
  await t.test("subtest", () => {
    throw new Promise((resolve, reject) => (rejectPromiseOfSubtest = reject));
  });
  rejectPromiseOfSubtest(new Error("the reason of a promise that was pending"));
  await nextImmediate();
});

test("passes after the test whose subtest threw a pending promise", async () => {
  await nextImmediate();
});

describe("a beforeEach hook that throws a rejected promise", () => {
  beforeEach(() => {
    throw rejected();
  });
  it("fails the test", () => {});
});

// Bun reports the failure of this hook between tests. Node fails the suite.
describe("a suite whose after hook throws a rejected promise", () => {
  after(() => {
    throw rejected();
  });
  it("passes", () => {});
});

describe("a test that throws a rejected promise", () => {
  let thrown;
  let seen;
  afterEach(t => {
    seen = thrownValue(t.error);
  });
  it("fails", () => {
    thrown = rejected();
    throw thrown;
  });
  it("gave the promise to the afterEach hook", () => {
    assert.strictEqual(seen, thrown);
  });
});

test("gives the promise that a beforeEach hook threw to the afterEach hook", async t => {
  let thrown;
  let seen;
  t.beforeEach(() => {
    thrown = rejected();
    throw thrown;
  });
  t.afterEach(t => {
    seen = thrownValue(t.error);
  });
  await t.test("subtest", { todo: true }, () => {});
  assert.strictEqual(seen, thrown);
});

test("expects a failure that matches the reason of the promise", { expectFailure: /the reason/ }, () => {
  throw rejected();
});

test("has a suite whose callback throws a rejected promise, and then waits", async () => {
  await describe("suite", () => {
    throw rejected();
  });
  await nextImmediate();
});

// `todo` keeps the failure of each suite below away from its test.
test("has a suite whose async callback rejects with a rejected promise", async () => {
  await describe("suite", { todo: true }, async () => {
    throw rejected();
  });
});

// The suite waits for the subtest, so it takes the failure of its callback in a later turn of the event loop.
test("has a suite whose async callback rejects with a rejected promise while a subtest runs", async t => {
  t.test("subtest", nextImmediate);
  await describe("suite", { todo: true }, async () => {
    throw rejected();
  });
});
