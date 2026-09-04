// The `timeout` option of a top-level suite, as in Node v26.3.0's Suite.run():
// when it fires, the child that is running is cancelled, the children and
// nested suites queued behind it never run, the suite's own after hooks still
// run (with the suite's own signal left alone: a timeout fails a suite, it does
// not abort it), and the suite itself fails with the timeout. The first suite
// here fails on purpose; node-test.test.ts asserts the exact counts and the
// OBS markers. Differences from `node --test` with this file: a suite's own
// failure shows up as a failed hook of its describe block, the children of a
// suite that never started are skipped rather than listed one by one, and the
// running child is cancelled before the after hooks run rather than after.
const { describe, it, before, after } = require("node:test");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A cancelled test's t.signal aborts; the sleep only bounds a runner that never
// cancels, so that such a runner reports the wrong outcome instead of hanging.
const untilCancelled = t =>
  Promise.race([new Promise(resolve => t.signal.addEventListener("abort", resolve)), sleep(200)]);

describe("suite that times out", { timeout: 20 }, () => {
  before(() => console.log("OBS before ran"));
  after(suite => console.log("OBS after ran, suite signal aborted: " + suite.signal.aborted));

  it("running when the suite times out", async t => {
    await untilCancelled(t);
    console.log("OBS running child settled, signal aborted: " + t.signal.aborted);
  });

  it("queued when the suite times out", () => {
    console.log("OBS queued child ran");
  });

  describe("nested suite queued when the suite times out", () => {
    before(() => console.log("OBS nested before ran"));
    after(() => console.log("OBS nested after ran"));
    it("nested child", () => console.log("OBS nested child ran"));
  });
});

// Also pins that the stop is released once the suite is done: a leaked 30s
// timer would keep the run() child of node-test.test.ts alive.
describe("suite within its timeout", { timeout: 30_000 }, () => {
  it("passes", () => {});

  // A test's own timeout still applies inside a suite that has one (this test
  // fails on purpose), and it does not stop the suite around it.
  it("has a shorter timeout of its own", { timeout: 20 }, async () => {
    await sleep(200);
  });

  it("still runs after a sibling timed out on its own", () => {});

  describe("nested suite without a timeout of its own", () => {
    it("passes too", () => {});
  });
});

// Node arms the suite's stop after its before hooks, so they do not count
// against the timeout. Had the stop been armed before the hook, its shorter
// timer would have fired during the hook and the child would have been
// cancelled without ever starting. The async callback also covers registering
// the suite's own bookkeeping after the callback's promise settles.
describe("suite whose before hook outlasts its timeout", { timeout: 1000 }, async () => {
  await null;
  before(() => sleep(1100));
  it("runs after the slow before hook", () => {
    console.log("OBS child ran after the slow before hook");
  });
});
