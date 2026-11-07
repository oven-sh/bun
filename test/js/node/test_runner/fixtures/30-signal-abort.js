// t.signal and the test-level `signal` option. Every observation is logged, and node-test.test.ts compares the
// log with what `node 30-signal-abort.js` (v26.3.0) prints, line for line. Nothing here waits for time to pass:
// a body that must outlive its test never settles, and a test that has to time out does so after 1ms.
const { test, describe, beforeEach, afterEach } = require("node:test");
const { getEventListeners } = require("node:events");

const log = (...args) => console.log("OBS", ...args);
const never = () => new Promise(() => {});
const outcome = t => `passed=${t.passed} error=${t.error && t.error.message} aborted=${t.signal.aborted}`;

describe("timeout", () => {
  afterEach(t => log(`afterEach(${t.name})`, outcome(t)));

  test("times out", { timeout: 1 }, async t => {
    const { signal } = t;
    signal.addEventListener("abort", () => log("abort event", "reason=" + signal.reason.name, outcome(t)));
    t.after(() => log("t.after", outcome(t)));
    await never();
  });

  // Node reads the option once, when test() is called.
  const options = { timeout: 1 };
  test("times out with the timeout it was declared with", options, async t => {
    t.signal.addEventListener("abort", () => log("abort event"));
    await never();
  });
  options.timeout = 60_000;
});

let suiteSignal;
describe("end of a test", suite => {
  suiteSignal = suite.signal;
  afterEach(t => log(`afterEach(${t.name})`, outcome(t)));
  let passing;
  let unread;

  test("passes", t => {
    passing = t;
    t.signal.addEventListener("abort", () => log("abort event after the hooks"));
    t.after(() => log("t.after", outcome(t), "same=" + (t.signal === passing.signal)));
  });
  test("throws", t => {
    t.signal.addEventListener("abort", () => log("abort event after the hooks"));
    throw new Error("boom");
  });
  test("never reads its signal", t => {
    unread = t;
  });
  test("reads them afterwards", () => {
    log("passing", "aborted=" + passing.signal.aborted, "reason=" + passing.signal.reason.name);
    log("unread", "aborted=" + unread.signal.aborted, "same=" + (unread.signal === unread.signal));
  });
});

describe("signal option", () => {
  const hooks = [];
  beforeEach(t => hooks.push(`beforeEach(${t.name})`));
  afterEach(t => {
    hooks.push(`afterEach(${t.name})`);
    log(`afterEach(${t.name})`, outcome(t));
  });

  test("already aborted", { signal: AbortSignal.abort(new Error("aborted before start")) }, () => {
    log("BODY RAN");
  });
  test("already aborted, callback style", { signal: AbortSignal.abort(new Error("cb")) }, (t, done) => {
    log("BODY RAN");
    done();
  });
  test("already aborted with a falsy reason", { signal: AbortSignal.abort(0) }, () => {
    log("BODY RAN");
  });

  const running = new AbortController();
  const reason = new Error("stop right there");
  test("aborted while running", { signal: running.signal }, async t => {
    const { signal } = t;
    log("own signal=" + (signal !== running.signal));
    signal.addEventListener("abort", () => log("abort event", "reason=" + signal.reason.name, outcome(t)));
    t.after(() => log("t.after", `failureType=${reason.failureType} error is the reason=${t.error === reason}`));
    running.abort(reason);
    await never();
  });

  const falsy = new AbortController();
  test("aborted with a falsy reason", { signal: falsy.signal }, async t => {
    t.after(() => log("t.after", "name=" + t.error.name, "code=" + t.error.code));
    falsy.abort(null);
    await never();
  });

  const thrower = new AbortController();
  test("aborted, then throws", { signal: thrower.signal }, () => {
    thrower.abort(new Error("the abort came first"));
    throw new Error("thrown after the abort");
  });

  const late = new AbortController();
  test("throws, then aborted in a microtask", { signal: late.signal }, () => {
    queueMicrotask(() => late.abort(new Error("too late")));
    throw new Error("the throw came first");
  });

  const timed = new AbortController();
  test("aborted with a timeout as well", { signal: timed.signal, timeout: 60_000 }, async () => {
    timed.abort(new Error("the reason wins"));
    await never();
  });

  const callback = new AbortController();
  test("aborted, callback style", { signal: callback.signal }, (t, done) => {
    callback.abort(new Error("callback reason"));
  });

  test("hooks of the tests that never started", () => {
    log(hooks.filter(hook => hook.includes("already aborted")).join(",") || "none");
  });
});

describe("signal option and hooks", () => {
  const inBeforeEach = new AbortController();
  const inAfterEach = new AbortController();
  const inAfter = new AbortController();
  const afterwards = new AbortController();
  let finished;
  beforeEach(t => {
    if (t.name === "aborted during beforeEach") inBeforeEach.abort(new Error("beforeEach reason"));
  });
  afterEach(t => {
    if (t.name === "aborted during afterEach") inAfterEach.abort(new Error("afterEach reason"));
    log(`afterEach(${t.name})`, outcome(t));
  });

  test("aborted during beforeEach", { signal: inBeforeEach.signal }, async t => {
    log("body starts", "aborted=" + t.signal.aborted);
    await never();
  });
  test("aborted during afterEach", { signal: inAfterEach.signal }, () => {});
  test("aborted during t.after", { signal: inAfter.signal }, t => {
    t.after(() => {
      inAfter.abort(new Error("t.after reason"));
      log("t.after", outcome(t));
    });
  });
  test("finished", { signal: afterwards.signal }, t => {
    finished = t;
    log("listeners on its signal while it runs:", getEventListeners(afterwards.signal, "abort").length);
  });
  test("aborted after it finished", () => {
    log("listeners on its signal afterwards:", getEventListeners(afterwards.signal, "abort").length);
    afterwards.abort(new Error("nobody is listening"));
    log("finished", `passed=${finished.passed} error=${finished.error}`);
  });
});

describe("options object", () => {
  const added = {};
  test("signal added after test() returned", added, () => {
    log("body ran");
  });
  added.signal = AbortSignal.abort(new Error("added too late"));

  const removed = { signal: AbortSignal.abort(new Error("removed too late")) };
  test("signal removed after test() returned", removed, () => {
    log("BODY RAN");
  });
  delete removed.signal;
});

// A cancelled test is over at once: the runner stops waiting for the body, and what the body does afterwards
// changes nothing. later() is the part of a body that runs only when the last test of the suite lets it.
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

describe("body that outlives its test", () => {
  afterEach(t => log(`afterEach(${t.name})`, outcome(t)));

  const resolves = new AbortController();
  test("resolves later", { signal: resolves.signal }, async t => {
    queueMicrotask(() => resolves.abort(new Error("aborted while the runner waits for the body")));
    await later(t.name);
    return "a late value";
  });

  const rejects = new AbortController();
  test("rejects later", { signal: rejects.signal }, async t => {
    queueMicrotask(() => rejects.abort(new Error("aborted while the runner waits for the body")));
    await later(t.name);
    throw new Error("a late error");
  });

  const first = new AbortController();
  test("aborted before its first await, rejects later", { signal: first.signal }, async t => {
    first.abort(new Error("aborted before the runner waits for the body"));
    await later(t.name);
    throw new Error("a late error");
  });

  const calls = new AbortController();
  test("calls back later", { signal: calls.signal }, (t, done) => {
    queueMicrotask(() => calls.abort(new Error("aborted while the runner waits for the callback")));
    later(t.name).then(() => done(new Error("a late callback error")));
  });

  let planned;
  test("times out while the runner waits for its plan", { timeout: 1 }, t => {
    planned = t;
    t.plan(1, { wait: true });
  });

  test("every body goes on", async () => {
    for (const { gate, went } of late) {
      gate.resolve();
      await went.promise;
    }
    planned.assert.ok(true);
  });
});

test("subtests", async t => {
  t.afterEach(child => log(`afterEach(${child.name})`, outcome(child)));
  const controller = new AbortController();
  await t.test("subtest aborted while running", { signal: controller.signal }, async child => {
    child.signal.addEventListener("abort", () => log("abort event"));
    controller.abort(new Error("subtest reason"));
    await never();
  });
  await t.test("subtest that times out", { timeout: 1 }, async child => {
    child.signal.addEventListener("abort", () => log("abort event"));
    await never();
  });
  const result = await t.test("subtest already aborted", { signal: AbortSignal.abort(new Error("sub")) }, () => {
    log("BODY RAN");
  });
  log("t.test() resolved with", result);
});

// Only a test aborts its signal when it ends. Suite#run() in Node never does.
test("a suite that ended", () => {
  log("suite signal", "aborted=" + suiteSignal.aborted);
});
