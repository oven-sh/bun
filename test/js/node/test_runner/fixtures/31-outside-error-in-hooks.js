const { test, after, beforeEach, afterEach } = require("node:test");

// An error thrown while a beforeEach or afterEach hook of a test is pending,
// by the very operation the hook waits on, so that hook never settles (a setup
// callback that throws before it resolves). bun:test fails the running test
// for it. The test must not sit there until the bun:test timeout: it gives up
// that hook, and its remaining hooks still run before the next test starts.
const log = [];

// Never settles: the callback that would resolve it throws first.
function brokenSetup(message) {
  return new Promise(() => {
    setTimeout(() => {
      throw new Error(message);
    }, 1);
  });
}

beforeEach(async t => {
  if (t.name !== "J") return;
  log.push("beforeEach(J)");
  await brokenSetup("thrown while a beforeEach hook was pending");
});

afterEach(async t => {
  log.push(`afterEach(${t.name})`);
  if (t.name === "H") await brokenSetup("thrown while an afterEach hook was pending");
});

afterEach(t => {
  log.push(`second afterEach(${t.name})`);
});

test("H", t => {
  t.after(() => log.push("t.after(H)"));
});

test("I", () => {
  log.push("I");
});

test("J", () => {
  log.push("J body");
});

test("K", () => {
  log.push("K");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
