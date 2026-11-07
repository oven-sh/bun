// A test that is over cancels the subtests it did not wait for, like postRun() in Node. Every observation is
// logged, and node-test.test.ts compares the log with what `node 31-cancelled-by-parent.js` (v26.3.0) prints.
// A cancelled subtest finishes on its own promise chain, so the order of the lines across subtests is not
// compared. Bodies that must outlive their test never settle, so nothing here waits for time to pass.
const { test, describe, it, before, after } = require("node:test");
const { AsyncLocalStorage } = require("node:async_hooks");

const log = (...args) => console.log("OBS", ...args);
const never = () => new Promise(() => {});
const outcome = t => `passed=${t.passed} error=${t.error && t.error.message} aborted=${t.signal.aborted}`;

test("parent that times out", { timeout: 1 }, async t => {
  let running;
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  t.after(() => log("parent t.after", "the running subtest is aborted=" + running.signal.aborted));
  // It ignores its signal: the runner must not need the body to finish a cancelled subtest.
  t.test("running", async child => {
    running = child;
    child.signal.addEventListener("abort", () => log("running: abort event", outcome(child)));
    child.after(() => log("running: t.after", "failureType=" + child.error.failureType));
    child.test("grandchild", async grandchild => {
      grandchild.signal.addEventListener("abort", () => log("grandchild: abort event"));
      await never();
    });
    await never();
  });
  t.test("queued", () => log("QUEUED BODY RAN")).then(() => log("QUEUED PROMISE SETTLED"));
  describe("queued suite", suite => {
    suite.signal.addEventListener("abort", () => log("queued suite: abort event"));
    before(() => log("QUEUED SUITE BEFORE HOOK RAN"));
    after(() => log("QUEUED SUITE AFTER HOOK RAN"));
    it("suite child", () => log("SUITE CHILD BODY RAN"));
  });
  describe("queued empty suite", () => {});
  await never();
});

const stop = new AbortController();
const store = new AsyncLocalStorage();
test("parent stopped by its signal", { signal: stop.signal }, async t => {
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  store.run("the caller's store", () => {
    t.test("running", async child => {
      child.after(() => log("running: t.after", "store=" + store.getStore()));
      stop.abort(new Error("stop the parent"));
      await never();
    });
  });
  await never();
});

test("parent that throws", async t => {
  t.test("running", async child => {
    child.signal.addEventListener("abort", () => log("child of the parent that throws: abort event"));
    child.after(() => log("child of the parent that throws: t.after", outcome(child)));
    await never();
  });
  throw new Error("the parent throws");
});

const during = new AbortController();
test("subtest cancelled during its beforeEach", { signal: during.signal }, async t => {
  t.beforeEach(() => {
    during.abort(new Error("stop during beforeEach"));
    log("beforeEach ends");
  });
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  await t.test("child", async child => {
    log("child body starts");
    await never();
  });
});

// The parent's after hook is still running when the first subtest ends, so the second one starts, and only
// then does the parent finish and sweep it.
const window = new AbortController();
test("subtest that starts after its parent was cancelled", { signal: window.signal }, async t => {
  const first = Promise.withResolvers();
  const secondStarted = Promise.withResolvers();
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  t.after(async () => {
    first.resolve();
    await secondStarted.promise;
    log("parent t.after ends");
  });
  t.test("first", async () => {
    window.abort(new Error("stop the parent"));
    await first.promise;
  });
  t.test("second", async child => {
    child.signal.addEventListener("abort", () => log("second: abort event"));
    secondStarted.resolve();
    await never();
  });
  await never();
});

// The oldest subtest has no sibling in front of it, only the parent's before hook, so Node had already started
// it: once the hook is over it runs up to its body, cancelled. The next one never starts.
const behind = new AbortController();
const hook = Promise.withResolvers();
const tail = Promise.withResolvers();
test("subtest behind its parent's before hook", { signal: behind.signal }, async t => {
  t.before(() => hook.promise);
  t.beforeEach(child => log(`beforeEach(${child.name})`, "aborted=" + child.signal.aborted));
  t.afterEach(child => {
    log(`afterEach(${child.name})`, outcome(child));
    tail.resolve();
  });
  t.test("oldest", () => log("oldest body starts"));
  t.test("next", () => log("NEXT BODY RAN"));
  behind.abort(new Error("stop the parent"));
  await never();
});
test("the before hook ends", async () => {
  hook.resolve();
  await tail.promise;
});

// The suite's describe() callback is still running when the parent is swept: what it declares afterwards is
// not taken.
const building = new AbortController();
const declared = Promise.withResolvers();
test("suite cancelled while its callback is running", { signal: building.signal }, async t => {
  describe("suite", async suite => {
    before(() => log("LATE SUITE BEFORE HOOK RAN"));
    await new Promise(resolve => suite.signal.addEventListener("abort", resolve));
    it("declared late", () => log("LATE BODY RAN"));
    declared.resolve();
  });
  building.abort(new Error("stop the parent"));
  await never();
});
test("the callback ends", () => declared.promise);

// A cancelled subtest is over at once as well, whatever its body does afterwards. later() is the part of a body
// that runs only when the last test lets it. Each parent is waiting for something else when it is cancelled: its
// body, its body behind an inline suite, and a subtest that fulfilled its plan.
const late = [];
function later(name) {
  const gate = Promise.withResolvers();
  const went = Promise.withResolvers();
  late.push({ gate, went });
  return gate.promise.then(() => {
    log(`${name}: the body goes on`);
    went.resolve();
  });
}

const rejecting = new AbortController();
test("subtest that rejects after it was cancelled", { signal: rejecting.signal }, async t => {
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  t.test("rejects later", async child => {
    rejecting.abort(new Error("stop the parent"));
    await later(child.name);
    throw new Error("a late error");
  });
  await never();
});

const inSuite = new AbortController();
test("suite child that resolves after it was cancelled", { signal: inSuite.signal }, async t => {
  describe("running suite", () => {
    after(() => log("running suite: after hook"));
    it("resolves later", async child => {
      child.after(() => log("resolves later: t.after", outcome(child)));
      inSuite.abort(new Error("stop the parent"));
      await later("suite child");
    });
  });
  await never();
});

const planned = new AbortController();
test("subtest that fulfilled its parent's plan", { signal: planned.signal }, t => {
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  t.plan(1, { wait: true });
  setImmediate(() => {
    t.test("planned", async child => {
      planned.abort(new Error("stop the parent"));
      await later(child.name);
    });
  });
});

test("every cancelled subtest goes on", async () => {
  for (const { gate, went } of late) {
    gate.resolve();
    await went.promise;
  }
});
