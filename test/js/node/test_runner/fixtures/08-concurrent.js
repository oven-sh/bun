const { test } = require("node:test");

// Run with `bun test --concurrent`: every node:test test then inherits
// concurrency, where bun:test's onTestFinished() throws if registered.
test("a", () => {});
test("b", () => {});
