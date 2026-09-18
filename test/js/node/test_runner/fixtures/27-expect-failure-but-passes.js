const { test } = require("node:test");

// Node fails a test that was expected to fail but did not.
test("passes unexpectedly", { expectFailure: true }, () => {});
