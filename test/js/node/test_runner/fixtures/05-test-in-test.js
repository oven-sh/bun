const { describe, test } = require("node:test");
const assert = require("node:assert");

test("t.test() runs subtests inline and returns a promise", async t => {
  const order = [];
  const result = await t.test("awaited subtest", subtest => {
    order.push("awaited");
    assert.strictEqual(subtest.name, "awaited subtest");
    assert.strictEqual(subtest.fullName, "t.test() runs subtests inline and returns a promise > awaited subtest");
  });
  assert.strictEqual(result, undefined);

  const unawaited = t.test("unawaited subtest", () => {
    order.push("unawaited");
  });
  assert.ok(unawaited instanceof Promise);

  await t.test("nested subtests", async subtest => {
    await subtest.test("inner", inner => {
      order.push("inner");
      assert.strictEqual(
        inner.fullName,
        "t.test() runs subtests inline and returns a promise > nested subtests > inner",
      );
    });
  });

  t.after(() => {
    // The unawaited subtest must have completed before the parent finished.
    assert.deepStrictEqual(order, ["awaited", "unawaited", "inner"]);
  });
});

test("test() and describe() called inside a running test become subtests", async t => {
  let describeRan = false;
  let itRan = false;

  test("global test() inside a running test", subtest => {
    assert.strictEqual(subtest.name, "global test() inside a running test");
    itRan = true;
  });

  describe("global describe() inside a running test", () => {
    test("nested test", subtest => {
      assert.strictEqual(
        subtest.fullName,
        "test() and describe() called inside a running test become subtests > global describe() inside a running test > nested test",
      );
      describeRan = true;
    });
  });

  t.after(() => {
    assert.ok(itRan, "global test() subtest ran");
    assert.ok(describeRan, "describe() subtest ran");
  });
});
