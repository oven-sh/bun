const test = require("node:test");
const assert = require("node:assert");

test("test() is a function", () => {
  assert(typeof test === "function", "test() is a function");
});

test("describe() is a function", () => {
  assert(typeof test.describe === "function", "describe() is a function");
});

test.describe("TestContext", () => {
  test("<exists>", t => {
    t.assert.ok(typeof t === "object", "test() returns an object");
  });

  test("name", t => {
    t.assert.equal(t.name, "name"); // matches the name of the test
  });

  test("filePath", t => {
    t.assert.equal(t.filePath, __filename);
  });

  test("signal", t => {
    t.assert.ok(t.signal instanceof AbortSignal);
  });

  test("assert", t => {
    t.assert.ok(typeof t.assert === "object", "test() argument has an assert property");
    const actual = Object.keys(t.assert).sort();
    const expected = Object.keys({ ...assert })
      .filter(key => !["CallTracker", "AssertionError", "strict"].includes(key))
      .concat(["fileSnapshot", "snapshot"])
      .sort();
    t.assert.deepEqual(actual, expected, "test() argument is the same as the node:assert module");
  });

  test("diagnostic()", t => {
    t.assert.ok(typeof t.diagnostic === "function", "diagnostic() is a function");
  });

  test("before()", t => {
    t.assert.ok(typeof t.before === "function", "before() is a function");
  });

  test("after()", t => {
    t.assert.ok(typeof t.after === "function", "after() is a function");
  });

  test("beforeEach()", t => {
    t.assert.ok(typeof t.beforeEach === "function", "beforeEach() is a function");
  });

  test("afterEach()", t => {
    t.assert.ok(typeof t.afterEach === "function", "afterEach() is a function");
  });

  test("test()", t => {
    t.assert.ok(typeof t.test === "function", "test() method is a function");
  });
});

test("before() is a function", t => {
  t.assert.ok(typeof test.before === "function", "before() is a function");
});

test("after() is a function", t => {
  t.assert.ok(typeof test.after === "function", "after() is a function");
});

test("beforeEach() is a function", t => {
  t.assert.ok(typeof test.beforeEach === "function", "beforeEach() is a function");
});

test("afterEach() is a function", t => {
  t.assert.ok(typeof test.afterEach === "function", "afterEach() is a function");
});

test.describe("test", () => {
  test("test()", t => {
    t.assert.ok(typeof test === "function", "test() is a function");
  });

  test("it()", t => {
    t.assert.ok(typeof test.it === "function", "test.it() is a function");
  });

  test("skip()", t => {
    t.assert.ok(typeof test.skip === "function", "test.skip() is a function");
  });

  test("todo()", t => {
    t.assert.ok(typeof test.todo === "function", "test.todo() is a function");
  });

  test("only()", t => {
    t.assert.ok(typeof test.only === "function", "test.only() is a function");
  });

  test("describe()", t => {
    t.assert.ok(typeof test.describe === "function", "test.describe() is a function");
  });

  test("suite()", t => {
    t.assert.ok(typeof test.suite === "function", "test.suite() is a function");
  });
});

test.describe("describe", () => {
  test("<exists>", t => {
    t.assert.ok(typeof test.describe === "function", "describe() is a function");
  });

  test("skip()", t => {
    t.assert.ok(typeof test.describe.skip === "function", "describe.skip() is a function");
  });

  test("todo()", t => {
    t.assert.ok(typeof test.describe.todo === "function", "describe.todo() is a function");
  });

  test("only()", t => {
    t.assert.ok(typeof test.describe.only === "function", "describe.only() is a function");
  });
});

test.describe("describe 1", t => {
  test("name is correct", t => {
    t.assert.equal(t.name, "name is correct");
  });

  test("fullName is correct", t => {
    t.assert.equal(t.fullName, "describe 1 > fullName is correct");
  });

  test.describe("describe 2", () => {
    test("name is correct", t => {
      t.assert.equal(t.name, "name is correct");
    });

    test("fullName is correct", t => {
      t.assert.equal(t.fullName, "describe 1 > describe 2 > fullName is correct");
    });
  });
});
