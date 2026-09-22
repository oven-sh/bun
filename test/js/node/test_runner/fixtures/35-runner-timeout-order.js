const { test, describe, after, beforeEach, afterEach } = require("node:test");

// node-test.test.ts runs this file with a short `--timeout`. That timeout, not
// a `timeout` option, ends the tests whose body or beforeEach hook stays
// pending. Their afterEach/after hooks and their t.mock restore must run then,
// before the next test starts. `node --test --test-timeout=<ms>` prints the
// same ORDER.
const log = [];
const api = { read: () => "real" };
let shared = "clean";

// Node's timeout timer is unref'd, so a pending body alone would let it exit.
const keepAlive = setInterval(() => {}, 1000);

// The tests that must pass opt out of the short timeout.
const untimed = { timeout: Infinity };

// Lets the pending body of the test before settle, which is when its detached
// hooks would run, and gives them a turn of the event loop to do so.
function settle(release) {
  release();
  return new Promise(resolve => setImmediate(resolve));
}

afterEach(t => {
  log.push(`afterEach(${t.name})`);
  shared = "clean";
});

let releaseA;
test("A", async t => {
  t.after(() => log.push("t.after(A)"));
  t.mock.method(api, "read", () => "mocked");
  shared = "dirty-by-A";
  await new Promise(resolve => (releaseA = resolve));
});

test("B", untimed, async () => {
  log.push(`B start shared=${shared} read=${api.read()}`);
  shared = "used-by-B";
  await settle(releaseA);
  log.push(`B end shared=${shared}`);
});

let releaseP;
test("P", async t => {
  t.after(() => log.push("t.after(P)"));
  await t.test("sub1", () => {
    log.push("sub1");
  });
  await new Promise(resolve => (releaseP = resolve));
});

test("C", untimed, async () => {
  log.push("C start");
  await settle(releaseP);
  log.push("C end");
});

describe("suite", () => {
  afterEach(t => log.push(`suite afterEach(${t.name})`));

  let releaseR;
  test("R", async t => {
    t.after(() => log.push("t.after(R)"));
    await new Promise(resolve => (releaseR = resolve));
  });

  test("D", untimed, async () => {
    log.push("D start");
    await settle(releaseR);
    log.push("D end");
  });
});

// The timeout expires while a beforeEach hook of J is pending: the body of J
// must not run, and never during K.
let releaseHook;
beforeEach(async t => {
  if (t.name !== "J") return;
  log.push("beforeEach(J)");
  await new Promise(resolve => (releaseHook = resolve));
  log.push("beforeEach(J) end");
});

test("J", () => {
  log.push("J body");
});

test("K", untimed, async () => {
  log.push("K start");
  await settle(releaseHook);
  log.push("K end");
});

after(() => {
  clearInterval(keepAlive);
  console.log("ORDER=" + JSON.stringify(log));
});
