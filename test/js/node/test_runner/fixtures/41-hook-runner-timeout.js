// node-test.test.ts runs this with `--timeout 100`: a before() hook without a
// timeout of its own is ended at the runner default.
const { before, test } = require("node:test");

before(async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
});

test("a test", () => {});
