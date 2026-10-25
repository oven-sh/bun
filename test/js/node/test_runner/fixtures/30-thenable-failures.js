// A test fails when it throws a promise or another thenable, and when its
// error has a then() method. Node v26.3.0 gives the same verdict for each test.
const assert = require("node:assert");
const { test, describe, it, beforeEach, afterEach, after } = require("node:test");

const thenable = () => ({
  then(resolve) {
    resolve();
  },
});

test("throws a promise", () => {
  throw Promise.resolve();
});

test("throws a thenable", () => {
  throw thenable();
});

test("rejects with a thenable", async () => {
  throw thenable();
});

test("throws a rejected promise", () => {
  throw Promise.reject(new Error("the reason of the thrown promise"));
});

test("calls done() with a promise", (t, done) => {
  done(Promise.resolve());
});

test("has a subtest that throws a promise", async t => {
  await t.test("subtest", () => {
    throw Promise.resolve();
  });
});

test("has a todo subtest that throws a promise", async t => {
  await t.test("subtest", { todo: true }, () => {
    throw Promise.resolve();
  });
});

describe("a beforeEach hook that throws a promise", () => {
  beforeEach(() => {
    throw Promise.resolve();
  });
  it("fails the test", () => {});
});

describe("an afterEach hook that throws a thenable", () => {
  afterEach(() => {
    throw thenable();
  });
  it("fails the test", () => {});
});

test("has a before hook that throws a promise", async t => {
  t.before(() => {
    throw Promise.resolve();
  });
});

test("has an after hook that throws a promise", t => {
  t.after(() => {
    throw Promise.resolve();
  });
});

// From here on, every error has a then() method.
test("fails an assertion while Error.prototype.then exists", () => {
  Error.prototype.then = function (resolve) {
    resolve();
  };
  assert.strictEqual(1, 2);
});

test("times out while Error.prototype.then exists", { timeout: 1 }, () => new Promise(() => {}));

test("has a failing subtest while Error.prototype.then exists", async t => {
  await t.test("subtest", () => {
    throw new Error("the error of the subtest");
  });
});

after(() => {
  delete Error.prototype.then;
});
