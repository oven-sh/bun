const { test, after, beforeEach, afterEach } = require("node:test");

// An error thrown outside any promise while a beforeEach or afterEach hook of a
// test is pending. bun:test fails the running test for it (Node only prints a
// diagnostic). The hook still finishes and the test's remaining hooks still
// run before the next test starts. `node --test` prints the same ORDER.
const log = [];

// Runs `fail` from a timer callback and settles only after it, so the error
// always arrives while the awaiting hook is pending.
function pendingUntilAfter(fail) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => {
    setTimeout(resolve, 1);
    fail();
  }, 1);
  return promise;
}

beforeEach(async t => {
  if (t.name !== "J") return;
  log.push("beforeEach(J)");
  await pendingUntilAfter(() => {
    throw new Error("thrown from a timer of a beforeEach hook");
  });
  log.push("beforeEach(J) end");
});

afterEach(async t => {
  log.push(`afterEach(${t.name})`);
  if (t.name !== "H") return;
  await pendingUntilAfter(() => {
    throw new Error("thrown from a timer of an afterEach hook");
  });
  log.push("afterEach(H) end");
});

test("H", t => {
  t.after(() => log.push("t.after(H)"));
});

test("I", () => {
  log.push("I");
});

test("J", () => {});

test("K", () => {
  log.push("K");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
