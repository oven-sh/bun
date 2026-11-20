const { test } = require("node:test");
const assert = require("node:assert");

// This file fails on purpose. After a body that times out, the hooks of the
// test still run. A subtest that a hook awaits does not wait for the subtest
// that the body left.
const api = { now: () => "real" };
const events = [];

test("the body times out and leaves a subtest", { timeout: 50 }, t => {
  t.mock.method(api, "now", () => "mocked");
  t.after(async () => {
    await t.test("from the first after hook", () => {
      events.push("subtest of the first after hook");
    });
    events.push("first after hook");
  });
  t.after(() => events.push("second after hook"));
  t.test("does not settle", () => new Promise(() => {}));
});

test("the hooks ran and the mock is gone", () => {
  assert.deepStrictEqual(events, ["subtest of the first after hook", "first after hook", "second after hook"]);
  assert.strictEqual(api.now(), "real");
});
