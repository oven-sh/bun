// Done-callback signatures for tests and hooks (Node passes `done` when the
// function declares a second parameter), matched against Node v26.3.0.
const assert = require("node:assert");
const { test, before, beforeEach } = require("node:test");

const order = [];
before((t, done) => {
  setImmediate(() => {
    order.push("before");
    done();
  });
});
beforeEach((t, done) => {
  order.push("beforeEach");
  done();
});

test("file-level hooks with done callbacks ran first", (t, done) => {
  assert.deepStrictEqual(order, ["before", "beforeEach"]);
  setImmediate(done);
});

test("t.beforeEach with a done callback applies to subtests", async t => {
  const ran = [];
  t.beforeEach((ctx, done) => {
    ran.push("subtest-hook");
    done();
  });
  await t.test("subtest", () => {});
  assert.deepStrictEqual(ran, ["subtest-hook"]);
});
