// node-test.test.ts runs this with `--timeout 10`: the hook's own timeout, not
// the runner default, ends a before() hook that never settles.
const { before, test } = require("node:test");

before(() => new Promise(() => {}), { timeout: 50 });

test("a test", () => {});
