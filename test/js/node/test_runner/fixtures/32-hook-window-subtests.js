const test = require("node:test");
const assert = require("node:assert");

// A test is not finished while its afterEach and after hooks run. A subtest
// that a hook creates there and awaits is an ordinary subtest.
const events = [];

test("a subtest from an after hook", t => {
  t.after(async () => {
    await t.test("from after", () => {
      events.push("from after");
    });
  });
});

test("a subtest from an afterEach hook", async t => {
  t.afterEach(async ctx => {
    // The hook runs for the subtest that it creates too.
    if (ctx.name !== "child") return;
    await ctx.test("from afterEach", () => {
      events.push("from afterEach");
    });
  });
  await t.test("child", () => {});
});

test("the hooks ran their subtests", () => {
  assert.deepStrictEqual(events, ["from after", "from afterEach"]);
});
