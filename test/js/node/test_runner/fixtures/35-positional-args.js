// Node reads the (name, options, fn) arguments of test() and describe() slot by
// slot (nodejs/node lib/internal/test_runner/test.js:1013-1025). Only a
// non-empty string is a name (test.js:579), and a name of any other type still
// leaves the options and the function to be read from the next slots.
// Passes on the node v26.3.0 binary.
const { test, it, describe, suite, before } = require("node:test");
const assert = require("node:assert");

const ran = [];
const expected = [];

// A test body that must run once. `name` is the name Node gives the test.
function body(label, name = "named") {
  expected.push(label);
  return function named(t) {
    ran.push(label);
    assert.strictEqual(t.name, name);
  };
}

// A suite callback whose child must run once. A dropped callback registers no child.
function suiteBody(label, fullName = "namedSuite > child") {
  expected.push(label);
  return function namedSuite() {
    it("child", t => {
      ran.push(label);
      assert.strictEqual(t.fullName, fullName);
    });
  };
}

const mustNotRun = label =>
  function named() {
    ran.push(`must not run: ${label}`);
  };

function codeOf(register) {
  try {
    register();
  } catch (error) {
    return error.code;
  }
  return "did not throw";
}

// (a) The name is not a string, a function or an options object.
for (const name of [undefined, null, 42, true, Symbol("name"), 1n]) {
  const shown = String(name);
  test(name, body(`test(${shown}, fn)`));
  test(name, { timeout: 5000 }, body(`test(${shown}, options, fn)`));
  describe(name, suiteBody(`describe(${shown}, fn)`));
}
it(undefined, body("it(undefined, fn)"));
test(null, null, body("test(null, null, fn)"));
suite(undefined, {}, suiteBody("suite(undefined, options, fn)"));
expected.push("test(undefined, arrow)");
test(undefined, t => {
  ran.push("test(undefined, arrow)");
  assert.strictEqual(t.name, "<anonymous>");
});

// (b) A string name, then a value that is neither options nor a function.
for (const options of [undefined, 5, "x"]) {
  test("b", options, body(`test("b", ${options}, fn)`, "b"));
  describe("b suite", options, suiteBody(`describe("b suite", ${options}, fn)`, "b suite > child"));
}

// (c) The empty string is not a name.
test("", body('test("", fn)'));
test("", {}, body('test("", options, fn)'));
describe("", suiteBody('describe("", fn)'));
expected.push('test("", arrow)');
test("", t => {
  ran.push('test("", arrow)');
  assert.strictEqual(t.name, "<anonymous>");
});

// The name pattern (`bun test -t`, `node --test-name-pattern`) sees the name taken from the function.
expected.push("test(undefined, pickme)");
test(undefined, function pickme(t) {
  ran.push("test(undefined, pickme)");
  assert.strictEqual(t.name, "pickme");
});

// The .only, .skip and .todo spellings.
test.only(undefined, body("test.only(undefined, fn)"));
describe.only(undefined, suiteBody("describe.only(undefined, fn)"));
test.skip(undefined, function skipSpelling() {
  ran.push("must not run: test.skip(undefined, fn)");
});
describe.skip(undefined, mustNotRun("describe.skip(undefined, fn)"));
test.todo(undefined, function todoSpelling() {});

// The options apply from each slot Node reads them from.
test(undefined, { skip: true }, function skippedByOptions() {
  ran.push("must not run: test(undefined, { skip: true }, fn)");
});
test(undefined, { todo: true }, function todoByOptions() {});
describe(undefined, { skip: true }, mustNotRun("describe(undefined, { skip: true }, fn)"));
test({ skip: true }, mustNotRun("test({ skip: true }, fn)"));
test(mustNotRun("test(fn, { skip: true })"), { skip: true });
const codes = [
  codeOf(() => test(undefined, { timeout: "x" }, mustNotRun("test with an invalid timeout"))),
  codeOf(() => describe(null, { timeout: -1 }, mustNotRun("describe with an invalid timeout"))),
];

// Slots Node never reads as the body.
test({}, undefined, mustNotRun("test(options, undefined, fn)"));
test(body("test(fn, fn2)"), mustNotRun("the second function of test(fn, fn2)"));
before(undefined, mustNotRun("before(undefined, fn)"));

// No function in any slot: a no-op named "<anonymous>".
test();
test(undefined);
test(null, {});
test("");
test({ timeout: 5000 });
test("only a name");
test.todo("todo with only a name");

test("registrations made while a test runs", async t => {
  await t.test(undefined, body("t.test(undefined, fn)"));
  await t.test(7, {}, body("t.test(7, options, fn)"));
  await t.test("", body('t.test("", fn)'));
  await t.test("sub", undefined, body('t.test("sub", undefined, fn)', "sub"));
  await t.test(undefined, { skip: true }, mustNotRun("t.test(undefined, { skip: true }, fn)"));
  assert.throws(() => t.test(undefined, { timeout: "x" }, mustNotRun("t.test with an invalid timeout")), {
    code: "ERR_INVALID_ARG_TYPE",
  });
  await test(undefined, body("test(undefined, fn) in a test"));
  await describe(undefined, suiteBody("describe(undefined, fn) in a test", `${t.name} > namedSuite > child`));
  // t.describe() is a Bun extension.
  if (typeof t.describe === "function") {
    await t.describe(undefined, suiteBody("t.describe(undefined, fn)", `${t.name} > namedSuite > child`));
  }
});

test("every body ran once and nothing else ran", () => {
  assert.deepStrictEqual(ran.toSorted(), expected.toSorted());
  assert.deepStrictEqual(codes, ["ERR_INVALID_ARG_TYPE", "ERR_OUT_OF_RANGE"]);
});
