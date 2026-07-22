// A top-level test() registered from a macrotask that fires while a
// collection-phase test is still awaiting (Phase::Execution, not Done) must
// queue behind it. Node's root serializes subtests; running the late body on
// the next microtask would re-fire beforeEach under the still-running test.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

let state;
const order = [];
beforeEach(() => {
  state = {};
});

test("slow", async () => {
  const mine = state;
  order.push("slow-start");
  await new Promise(resolve => setTimeout(resolve, 100));
  order.push("slow-end");
  assert.ok(mine === state, "beforeEach ran while slow was awaiting");
});

setTimeout(() => {
  test("late", () => {
    order.push("late");
  });
  test("prints order", () => {
    console.error("ORDER=" + order.join(","));
  });
}, 10);
