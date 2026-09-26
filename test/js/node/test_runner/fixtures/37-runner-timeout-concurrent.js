const { test, after, afterEach } = require("node:test");

// node-test.test.ts runs this file with `--concurrent` and a short `--timeout`.
// Both bodies stay pending, in one concurrent group. Each test must still run
// its afterEach hook when the timeout ends it.
const log = [];

afterEach(t => {
  log.push(`afterEach(${t.name})`);
});

test("S1", () => new Promise(() => {}));

test("S2", () => new Promise(() => {}));

after(() => console.log("ORDER=" + JSON.stringify(log)));
