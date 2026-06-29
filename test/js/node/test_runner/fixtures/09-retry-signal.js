const { test } = require("node:test");

// Run with `bun test --retry 2`. The same TestContext is reused for every
// attempt, so a retry must not observe the previous attempt's aborted signal.
let attempt = 0;
test("flaky", t => {
  if (t.signal.aborted) throw new Error("SIGNAL_ALREADY_ABORTED_ON_ENTRY");
  if (++attempt < 2) throw new Error("transient");
});
