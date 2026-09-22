const { test, describe, after, afterEach } = require("node:test");

// An error thrown outside a test's promise while its body is pending (a timer
// callback that throws, a rejection nothing handles) fails the test at once.
// Its afterEach/after hooks, its t.mock restore and its remaining subtests must
// run then, before the next test starts. `node --test` prints the same ORDER.
const log = [];
const api = { read: () => "real" };
let shared = "clean";

// Runs `fail` from a timer callback and settles only after it, so the error
// always arrives while the awaiting body is pending.
function pendingUntilAfter(fail) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => {
    setTimeout(resolve, 1);
    fail();
  }, 1);
  return promise;
}

afterEach(t => {
  log.push(`afterEach(${t.name})`);
  shared = "clean";
});

let bodyOfA;
test("A", async t => {
  t.after(() => log.push("t.after(A)"));
  t.mock.method(api, "read", () => "mocked");
  shared = "dirty-by-A";
  bodyOfA = pendingUntilAfter(() => {
    throw new Error("thrown from a timer of A");
  });
  await bodyOfA;
});

// Each follow-up test stays pending until the failed body before it settles,
// which is when a detached afterEach would run.
test("B", async () => {
  log.push(`B start shared=${shared} read=${api.read()}`);
  shared = "used-by-B";
  await bodyOfA;
  log.push(`B end shared=${shared}`);
});

let bodyOfSub1;
test("P", async t => {
  await t.test("sub1", async () => {
    log.push("sub1");
    bodyOfSub1 = pendingUntilAfter(() => {
      throw new Error("thrown from a timer of sub1");
    });
    await bodyOfSub1;
  });
  await t.test("sub2", () => {
    log.push("sub2");
  });
  log.push("P end");
});

test("C", async () => {
  log.push("C start");
  await bodyOfSub1;
  log.push("C end");
});

describe("suite", () => {
  let bodyOfR;
  test("R", async t => {
    t.after(() => log.push("t.after(R)"));
    bodyOfR = pendingUntilAfter(() => {
      Promise.reject(new Error("rejected in R"));
    });
    await bodyOfR;
  });

  test("D", async () => {
    log.push("D start");
    await bodyOfR;
    log.push("D end");
  });
});

// A listener that throws inside dispatchEvent() is reported while the body is
// still in its synchronous part: no microtask may run under that frame, and
// the body, which never settles, must still be given up.
test("S", async () => {
  const seen = [];
  queueMicrotask(() => seen.push("microtask"));
  const target = new EventTarget();
  target.addEventListener("x", () => {
    throw new Error("thrown from a listener of S");
  });
  target.dispatchEvent(new Event("x"));
  log.push(`S after dispatchEvent seen=${seen}`);
  await new Promise(() => {});
});

test("E", () => {
  log.push("E");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
