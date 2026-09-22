const { test, after, afterEach } = require("node:test");
const { afterEach: bunAfterEach } = require("bun:test");

// node-test.test.ts runs this file with a short `--timeout`. That timeout ends
// H, whose afterEach hook then never settles. bun:test must still move on to
// the next test, one more timeout later, and must still run its own afterEach
// hooks for H (a `--preload` cleanup has that shape).
const log = [];

bunAfterEach(() => {
  log.push("bun:test afterEach");
});

afterEach(t => {
  log.push(`afterEach(${t.name})`);
  if (t.name === "H") return new Promise(() => {});
});

test("H", () => new Promise(() => {}));

test("I", { timeout: Infinity }, () => {
  log.push("I");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
