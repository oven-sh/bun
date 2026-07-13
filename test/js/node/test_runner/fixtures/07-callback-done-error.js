const { test } = require("node:test");

// Callback-style test that reports failure via done(error) must fail.
test("callback test fails when done() is called with an error", (t, done) => {
  done(new Error("boom"));
});
