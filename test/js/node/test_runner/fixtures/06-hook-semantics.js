// Hook and mock-registry semantics that must match Node v26.3.0.
const assert = require("node:assert");
const { test, before, mock } = require("node:test");

test("t.before() registered on a running test runs exactly once", async t => {
  let runs = 0;
  t.before(() => {
    runs++;
  });
  await t.test("first subtest", () => {});
  await t.test("second subtest", () => {});
  assert.strictEqual(runs, 1);
});

test("before() registered inside a running test runs exactly once", async t => {
  let runs = 0;
  before(() => {
    runs++;
  });
  await t.test("subtest", () => {});
  assert.strictEqual(runs, 1);
});

test("hook options are validated", t => {
  assert.throws(() => t.before(() => {}, { timeout: "x" }), { code: "ERR_INVALID_ARG_TYPE" });
  assert.throws(() => t.beforeEach(() => {}, { timeout: -1 }), { code: "ERR_OUT_OF_RANGE" });
  assert.throws(() => t.after(() => {}, { signal: {} }), { code: "ERR_INVALID_ARG_TYPE" });
  assert.throws(() => before(() => {}, { timeout: Symbol() }), { code: "ERR_INVALID_ARG_TYPE" });
});

test("mock once registries never call user-patched Map.prototype methods", () => {
  const keys = ["get", "set", "has", "delete"];
  const original = {};
  const calls = [];
  for (const key of keys) {
    original[key] = Map.prototype[key];
    Map.prototype[key] = function (...args) {
      calls.push(key);
      return original[key].apply(this, args);
    };
  }
  let fnResults;
  let propertyReads;
  let observedCalls;
  try {
    const f = mock.fn(
      () => "orig",
      () => "orig",
    );
    f.mock.mockImplementationOnce(() => "once");
    fnResults = [f(), f()];
    const target = { p: 1 };
    const p = mock.property(target, "p", 2);
    p.mock.mockImplementationOnce(3);
    propertyReads = [target.p, target.p];
    observedCalls = calls.length;
    mock.reset();
  } finally {
    for (const key of keys) {
      Map.prototype[key] = original[key];
    }
  }
  assert.deepStrictEqual(fnResults, ["once", "orig"]);
  assert.deepStrictEqual(propertyReads, [3, 2]);
  assert.strictEqual(observedCalls, 0);
});
