const test = require("node:test");

// bun only: this file fails on purpose. It pins the `error:` lines that
// `bun test` prints for each kind of failure. The error that a hook can read
// as context.error is Node's ERR_TEST_FAILURE. What bun prints is the thrown value.
test("throws an error", () => {
  throw new Error("thrown by the test");
});

test("throws undefined", () => {
  throw undefined;
});

test("plan mismatch", t => {
  t.plan(2);
});

test("timeout", { timeout: 5 }, () => new Promise(() => {}));

test("a subtest fails", async t => {
  await t.test("child", () => {
    throw new Error("thrown by the child");
  });
});

test("a beforeEach hook fails", async t => {
  t.beforeEach(() => {
    throw new Error("thrown by the hook");
  });
  await t.test("child", () => {});
});

test("expected to fail", { expectFailure: true }, () => {});

test("plan twice", t => {
  t.plan(1);
  t.plan(1);
});

test("callback twice", (t, done) => {
  done();
  done();
});

test("a beforeEach hook times out", async t => {
  t.beforeEach(() => new Promise(() => {}), { timeout: 5 });
  await t.test("child", () => {});
});

test("a beforeEach hook throws undefined", async t => {
  t.beforeEach(() => {
    throw undefined;
  });
  await t.test("child", () => {});
});
