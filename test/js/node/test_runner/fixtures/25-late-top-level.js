// A top-level test() registered from a macrotask after module evaluation must
// run and be counted. Node keeps the root alive while a ref'd timer is pending
// and runs late registrations as root subtests; bun:test is past collection at
// that point, so the node:test shim runs them inline and reports the result.
const { test, describe } = require("node:test");
const assert = require("node:assert");

test("sync-registered", () => {});

setTimeout(() => {
  test("late failing", () => {
    assert.fail("late test is red");
  });
  test("late passing", () => {});
  test("late async passing", async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  describe("late suite", () => {
    test("late suite child fails", () => {
      assert.fail("suite child is red");
    });
  });
}, 50);
