const test = require("node:test");

// Run after 10-describe-concurrency.js in one `bun test` invocation. A prior
// file's concurrent tests must not leave a stale "inside a test" context in
// the node:test module, or this top-level registration throws.
test("registers after a concurrent file", () => {
  console.log("LOG:after-concurrent");
});
