// t.signal costs nothing until it is read: no test here reads it or has a `signal` option, so none of them makes
// an AbortController. The first read makes it, already aborted when the test is over by then (a suite that ended
// is not aborted). bun:jsc counts the controllers that are alive, and `contexts` keeps all of them alive.
const { test, describe, it } = require("node:test");
const { heapStats } = require("bun:jsc");

const log = (...args) => console.log("OBS", ...args);
const controllers = () => heapStats().objectTypeCounts.AbortController ?? 0;
const contexts = [];
const before = controllers();

test("plain", t => {
  contexts.push(t);
});

test("with a timeout", { timeout: 60_000 }, async t => {
  contexts.push(t);
  await null;
});

test("with hooks, subtests and a suite", async t => {
  contexts.push(t);
  t.beforeEach(child => contexts.push(child));
  t.afterEach(() => {});
  t.after(() => {});
  await t.test("subtest", () => {});
  describe("suite", suite => {
    contexts.push(suite);
    it("suite child", () => {});
  });
  t.test("subtest that nothing awaits", () => {});
});

test("that times out", { timeout: 1 }, async t => {
  contexts.push(t);
  await new Promise(() => {});
});

test("none of them made a signal", () => {
  log("contexts=" + contexts.length, "controllers made=" + (controllers() - before));
});

test("the first read makes it", () => {
  const aborted = contexts.map(t => `${t.name}=${t.signal.aborted}`);
  log("controllers made=" + (controllers() - before), "aborted:", aborted.join(", "));
});
