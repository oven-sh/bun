// test([name][, options][, fn]): Node shifts the three positionals and then gives
// each slot its default, so a name or an options value that it cannot use never
// hides the function in a later slot.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/test_runner/test.js#L1013-L1025
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/test_runner/test.js#L575-L581
//
// This file also passes on Node: run it with `node --test`. A plain `node <file>`
// applies the two `.only` cells, runs nothing else, and still exits 0.
const assert = require("node:assert");
const { test, it, describe, suite, before, beforeEach, after } = require("node:test");

const ran = [];
const expected = [];
// A function named "named" that must run, in a test that must end up named `testName`.
function runs(id, testName = "named") {
  expected.push(id);
  return function named(t) {
    ran.push(id);
    assert.strictEqual(t.name, testName);
  };
}
// The same with an anonymous function: only a usable string name keeps the test from being "<anonymous>".
function runsAnonymous(id, testName = "<anonymous>") {
  expected.push(id);
  return t => {
    ran.push(id);
    assert.strictEqual(t.name, testName);
  };
}
const never = id => () => ran.push(`MUST NOT RUN: ${id}`);
// An options object that changes nothing: it only has to be taken as the options.
const options = { skip: false };

// The name is not a string, a function or an object: the next slots are read as usual.
const names = { undefined: undefined, null: null, number: 42, zero: 0, boolean: true, symbol: Symbol("s"), bigint: 1n };
for (const [kind, name] of Object.entries(names)) {
  test(name, runs(`test(${kind}, fn)`));
}
test(undefined, runsAnonymous("test(undefined, anonymous fn)"));
test(undefined, undefined, runs("test(undefined, undefined, fn)"));
test(null, null, runs("test(null, null, fn)"));
test(null, options, runs("test(null, options, fn)"));
test(undefined, 42, runs("test(undefined, 42, fn)"));
test(undefined, runs("test(undefined, fn1, fn2) runs fn1"), never("fn2 of test(undefined, fn1, fn2)"));
test(undefined, { skip: true }, never("test(undefined, { skip: true }, fn)"));
it(undefined, runs("it(undefined, fn)"));
test.only(undefined, runs("test.only(undefined, fn)"));
test.skip(undefined, never("test.skip(undefined, fn)"));

// The name is a string and the options slot is not an object: the function is still the third slot.
for (const [kind, value] of Object.entries({ undefined: undefined, number: 42, boolean: true, string: "y" })) {
  test(`options: ${kind}`, value, runs(`test(name, ${kind}, fn)`, `options: ${kind}`));
}

// An empty name is replaced like any other name that is not usable.
test("", runs('test("", fn)'));
test("", runsAnonymous('test("", anonymous fn)'));
test("", options, runs('test("", options, fn)'));
test("", undefined, runs('test("", undefined, fn)'));
test("", { skip: true }, never('test("", { skip: true }, fn)'));

// Suites take the same path: when the callback is dropped, no child is ever declared.
const suiteNames = [];
describe(42, function numberSuite(s) {
  suiteNames.push(s.name);
  it("child", runs("describe(42, fn)", "child"));
});
suite(undefined, () => {
  it("child", runs("suite(undefined, fn)", "child"));
});
describe.only(null, options, () => {
  it("child", runs("describe.only(null, options, fn)", "child"));
});
describe("suite options: undefined", undefined, () => {
  it("child", runs("describe(name, undefined, fn)", "child"));
  test(undefined, runs("test(undefined, fn) in a suite"));
});
describe.skip(undefined, never("describe.skip(undefined, fn)"));

// Subtests, and the module-level functions called inside a running test.
test("subtests", async t => {
  await t.test(5, runs("t.test(5, fn)"));
  await t.test("sub", undefined, runs("t.test(name, undefined, fn)", "sub"));
  await t.test(undefined, { todo: true }, runs("t.test(undefined, { todo: true }, fn)"));
  await t.test(undefined, { skip: true }, never("t.test(undefined, { skip: true }, fn)"));
  await test(undefined, runs("test(undefined, fn) in a test"));
  await describe(7, () => {
    it("child", runs("describe(7, fn) in a test", "child"));
  });
});

// The options are validated in the slot that the shift selects, when the test is declared.
test("options are validated at declaration", () => {
  const invalid = { timeout: "soon" };
  const error = { code: "ERR_INVALID_ARG_TYPE" };
  assert.throws(() => test(undefined, invalid, () => {}), error);
  assert.throws(() => describe(42, invalid, () => {}), error);
  assert.throws(() => test("", invalid, () => {}), error);
  assert.throws(() => test("name", invalid, () => {}), error);
  assert.throws(() => test(() => {}, invalid), error);
  assert.throws(() => test(invalid, () => {}), error);
  assert.throws(() => test(invalid), error);
});

// The documented forms keep their meaning.
test("name, fn", runs("test(name, fn)", "name, fn"));
test("name, anonymous fn", runsAnonymous("test(name, anonymous fn)", "name, anonymous fn"));
test("name, options, fn", options, runs("test(name, options, fn)", "name, options, fn"));
test("name, null, fn", null, runs("test(name, null, fn)", "name, null, fn"));
test("name, { skip: true }, fn", { skip: true }, never("test(name, { skip: true }, fn)"));
test(runs("test(fn)"));
test(runsAnonymous("test(anonymous fn)"));
test(runs("test(fn, options)"), options);
test(runs("test(fn, null)"), null);
test(never("test(fn, { skip: true })"), { skip: true });
test(options, runs("test(options, fn)"));
test(options, runsAnonymous("test(options, anonymous fn)"));
test({ skip: true }, never("test({ skip: true }, fn)"));

// Node does not read these slots either.
test(options, undefined, never("test(options, undefined, fn)"));
test(runs("test(fn1, fn2) runs fn1"), never("fn2 of test(fn1, fn2)"));
test("name, fn1, fn2", runs("test(name, fn1, fn2) runs fn1", "name, fn1, fn2"), never("fn2 of test(name, fn1, fn2)"));
test(options, runs("test(options, fn1, fn2) runs fn1"), never("fn2 of test(options, fn1, fn2)"));
before(undefined, never("before(undefined, fn)"));

// A test with no function passes. It keeps a usable string name, and every other name is "<anonymous>".
const withoutFunction = [];
describe("no function", () => {
  beforeEach(t => {
    withoutFunction.push(t.name);
  });
  test();
  test(undefined);
  test(42);
  test(null, options);
  test(undefined, options, "not a function");
  test(options);
  test("");
  test("", options);
  test("name only");
  test("name, options", options);
  test("name, number", 42);
  test("name, options, not a function", options, "not a function");
});

// In a hook, because a hook does not go through the parser under test: nothing can drop this check.
after(() => {
  console.log(`functions run: ${ran.length} of ${expected.length}`);
  assert.deepStrictEqual([...ran].sort(), [...expected].sort());
  assert.deepStrictEqual(suiteNames, ["numberSuite"]);
  const anonymous = new Array(8).fill("<anonymous>");
  assert.deepStrictEqual(withoutFunction, [
    ...anonymous,
    "name only",
    "name, options",
    "name, number",
    "name, options, not a function",
  ]);
});
