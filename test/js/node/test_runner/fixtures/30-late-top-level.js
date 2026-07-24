// A top-level test() registered from a macrotask after module evaluation must
// run and be counted. Node keeps the root alive while a ref'd timer is pending
// and runs late registrations as root subtests; bun:test is past collection at
// that point, so the node:test shim runs them inline and reports the result.
const { test, describe } = require("node:test");
const assert = require("node:assert");

// Records the order bodies execute in so the harness can verify the late chain
// serializes a describe()'s children behind earlier late tests (Node does).
const order = [];

test("sync-registered", () => {});

setTimeout(() => {
  test("late failing", () => {
    order.push("fail");
    assert.fail("late test is red");
  });
  test("late passing", () => {
    order.push("pass");
  });
  test("late async passing", async () => {
    order.push("async-start");
    await new Promise(resolve => setTimeout(resolve, 20));
    order.push("async-end");
  });
  describe("late suite", () => {
    test("late suite child fails", () => {
      order.push("suite-child");
      assert.fail("suite child is red");
    });
  });
  test.skip("late skipped", () => {
    order.push("skip-body");
  });
  test.todo("late todo", () => {
    order.push("todo-body");
  });
  test("late runtime skip", t => {
    order.push("runtime-skip");
    t.skip();
  });
  test("prints order", () => {
    console.error("ORDER=" + order.join(","));
  });
}, 50);
