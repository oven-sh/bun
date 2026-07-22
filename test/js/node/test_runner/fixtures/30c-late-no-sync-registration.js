// A file whose only node:test registrations arrive from a macrotask (the
// callback-driven fixture-list pattern). The drain flag must be set by loading
// node:test itself, not by a synchronous test() call, or the drain never runs.
const { test } = require("node:test");
const assert = require("node:assert");

setTimeout(() => {
  test("late only", () => assert.fail("late is red"));
}, 10);
