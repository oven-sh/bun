// Node v26.3.0 exits 0 for this file. The body of the test uses its whole
// timeout, so no time is left to wait for the subtest. A second wait of 3 s
// would end after the 5 s that bun:test gives the test.
const { test } = require("node:test");

test("a test that called t.skip() times out while its subtest never settles", { timeout: 3000 }, async t => {
  t.skip();
  t.test("skips and never settles", t2 => {
    t2.skip();
    return new Promise(() => {});
  });
  await new Promise(() => {});
});
