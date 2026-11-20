// The only test of this file is cancelled. `node <file>` prints
// `ok 1 - own timeout # EXPECTED FAILURE`, "cancelled 1" and exits 1, and
// run() reports the file itself as failed.
const { test } = require("node:test");

test("own timeout", { timeout: 50, expectFailure: true }, () => new Promise(() => {}));
