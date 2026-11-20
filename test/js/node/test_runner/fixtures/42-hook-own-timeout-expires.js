// The hook's own timeout ends a before() hook that never settles.
const { before, test } = require("node:test");

before(() => new Promise(() => {}), { timeout: 50 });

test("a test", () => {});
