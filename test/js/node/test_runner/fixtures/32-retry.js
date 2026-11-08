// Run with `bun test --retry 1`. bun:test calls the same test() callback again for a retry, so nothing that the
// first attempt did may reach the second one, and nothing that the caller did to its options object either.
const { test } = require("node:test");
const assert = require("node:assert");

const log = (...args) => console.log("OBS", ...args);
const attempts = {};
const attempt = t => (attempts[t.name] = (attempts[t.name] ?? 0) + 1);

test("t.plan()", t => {
  t.plan(1);
  t.assert.strictEqual(attempt(t), 2, "the first attempt fails");
});

let childRuns = 0;
test("subtests", async t => {
  const n = attempt(t);
  await t.test("child", () => {
    childRuns++;
    assert.strictEqual(n, 2, "the subtest of the first attempt fails");
  });
  log(`subtests: attempt ${n}`, "child runs=" + childRuns);
});

test("a subtest that fails on every attempt", async t => {
  if (attempt(t) === 1) throw new Error("the first attempt fails before its subtest");
  await t.test("child", () => {
    log("a subtest that fails on every attempt: it runs on the second attempt");
    throw new Error("fails on every attempt");
  });
});

let afterRuns = 0;
test("t.after()", t => {
  const n = attempt(t);
  t.after(() => log(`t.after(): hook of attempt ${n}`, "runs=" + ++afterRuns));
  assert.strictEqual(n, 2, "the first attempt fails");
});

test("tags", { tags: ["declared"] }, t => {
  log(`tags: attempt ${attempt(t)}`, t.tags.join());
  assert.strictEqual(attempts[t.name], 2, "the first attempt fails");
});

// The second attempt has the options of the declaration too.
test("expectFailure option", { expectFailure: true }, t => {
  if (attempt(t) === 2) throw new Error("fails on the second attempt, as expected");
});

test("plan option that is never met", { plan: 2 }, t => {
  t.assert.ok(true);
});

// The next four fail or pass the same way on every attempt. Each options object changes after its first test.
const skipNext = { skip: false };
test("fails, is not skipped", skipNext, () => {
  throw new Error("fails on every attempt");
});
skipNext.skip = "only this one";
test("is skipped", skipNext, () => {});

const expectNext = {};
test("fails, is not expected to", expectNext, () => {
  throw new Error("fails on every attempt");
});
expectNext.expectFailure = "only this one";
test("is expected to fail", expectNext, () => {
  throw new Error("a known failure");
});
