const test = require("node:test");
const assert = require("node:assert");
const { describe } = test;

describe("skipped suite", { skip: true }, () => {
  test("test in skipped suite", () => {
    assert.fail("must not run");
  });
});

describe("todo suite", { todo: true }, () => {
  test("test in todo suite", () => {
    assert.fail("must not run");
  });
});

test("test outside suites", () => {
  assert.ok(true);
});
