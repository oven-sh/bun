// Every test here must FAIL; node-test.test.ts asserts the exact counts.
// Node v26.3.0 fails all of them.
const { test, describe, before, after } = require("node:test");

test("a test body that rejects with undefined fails", () => Promise.reject());

test("an async function with a done callback fails", async (t, done) => {
  done();
});

test("a done callback invoked twice fails", (t, done) => {
  done();
  done();
});

test("a done callback called from a returned promise still fails", (t, done) => {
  return Promise.resolve().then(() => done());
});

test("an inline suite whose after hook fails fails the test", async () => {
  describe("after-failing suite", () => {
    after(() => {
      throw new Error("after hook boom");
    });
    test("child", () => {});
  });
});

test("an async before hook with a done callback fails the test", async t => {
  t.before(async (ctx, done) => {
    done();
  });
  await t.test("subtest", () => {});
});

test("an async inline describe callback rejection fails the test", async () => {
  describe("rejecting inline suite", async () => {
    await null;
    throw new Error("async describe boom");
  });
});

test("an inline suite whose before hook fails fails the test", async () => {
  describe("inline suite", () => {
    before(() => {
      throw new Error("inline suite before hook failed");
    });
  });
});

test("a before hook that exceeds its timeout fails the test", async t => {
  // The hook must outlive its 1ms timeout yet still settle, so that a build
  // without hook timeouts passes (and this fixture's expected counts differ).
  t.before(() => new Promise(resolve => setTimeout(resolve, 200)), { timeout: 1 });
  await t.test("subtest", () => {});
});

test("a subtest created after its parent before hook failed does not run", async t => {
  t.before(() => {
    throw new Error("boom");
  });
  let bodyRan = false;
  await t.test("subtest", () => {
    bodyRan = true;
  });
  console.log("SUB_BODY_RAN=" + bodyRan);
});
