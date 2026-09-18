// Inline suites (describe() inside a running test), matched against Node v26.3.0.
const assert = require("node:assert");
const { test, describe, before, it } = require("node:test");

test("inline suite children run after previously scheduled subtests", async t => {
  const order = [];
  t.test("first", async () => {
    order.push("first:start");
    await new Promise(resolve => setImmediate(resolve));
    order.push("first:end");
  });
  describe("inline suite", () => {
    test("child", () => {
      order.push("child");
    });
  });
  await t.test("last", () => {
    order.push("last");
  });
  assert.deepStrictEqual(order, ["first:start", "first:end", "child", "last"]);
});

test("an async inline describe callback is awaited before the suite finishes", async t => {
  const order = [];
  describe("async inline suite", async () => {
    test("early child", () => {
      order.push("early");
    });
    await null;
    test("late child", () => {
      order.push("late");
    });
  });
  await t.test("after the suite", () => {
    order.push("after");
  });
  assert.deepStrictEqual(order, ["early", "late", "after"]);
});

// A child registered before an async describe callback's first await must
// still observe a before() hook registered after that await (Node's
// Suite.run awaits buildPromise before running any subtest).
test("early inline-suite child waits for the async describe callback to settle", async t => {
  const order = [];
  await describe("async inline suite", async () => {
    it("early child", () => {
      order.push("child:" + globalThis.__node_test_09_before);
    });
    await null;
    before(() => {
      order.push("before");
      globalThis.__node_test_09_before = true;
    });
  });
  delete globalThis.__node_test_09_before;
  assert.deepStrictEqual(order, ["before", "child:true"]);
});
