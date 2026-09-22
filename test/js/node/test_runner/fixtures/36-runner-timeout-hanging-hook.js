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

// A bun:test afterEach that the body of a test adds must still run after the
// node:test hooks of that test, also when the timeout ends the test. It takes
// `done`: inside an AsyncLocalStorage context bun:test waits for it either way.
test("R", () => {
  bunAfterEach(done => {
    log.push("bun:test afterEach added by R");
    done();
  });
  return new Promise(() => {});
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
