// Each top-level test holds a failure that Node v26.3.0 counts: a test that did
// not pass and is neither skipped nor todo itself. A skip or todo on a test
// above it does not excuse that failure, so every test here makes the run red.
// `bun test` has one result per top-level test, so each one reports as a fail.
const { describe, it, test } = require("node:test");

const fail = () => {
  throw new Error("leaf error");
};

test("[fail] t.skip() after a failed subtest", async t => {
  await t.test("leaf", fail);
  t.skip();
});

test("[fail] t.todo() after a failed subtest", async t => {
  await t.test("leaf", fail);
  t.todo();
});

// `skipped` is not inherited, so the subtest is not skipped.
test("[fail] t.skip() before a failed subtest", async t => {
  t.skip();
  await t.test("leaf", fail);
});

test("[fail] t.skip() after two failed subtests and a passing one", async t => {
  await t.test("leaf a", fail);
  await t.test("leaf b", fail);
  await t.test("leaf c", () => {});
  t.skip();
});

test("[fail] t.skip(), a failed subtest, then a throw", async t => {
  await t.test("leaf", fail);
  t.skip();
  throw new Error("top error");
});

test("[fail] a subtest calls t.skip() after its own subtest failed", async t => {
  await t.test("mid", async t2 => {
    await t2.test("leaf", fail);
    t2.skip();
  });
});

// `mid` is todo, so it does not fail this test. `leaf` still counts.
test("[fail] a subtest calls t.todo() after its own subtest failed", async t => {
  await t.test("mid", async t2 => {
    await t2.test("leaf", fail);
    t2.todo();
  });
});

// A skipped subtest that did not pass fails its parent.
test("[fail] a subtest calls t.skip() and then throws", async t => {
  await t.test("leaf", t2 => {
    t2.skip();
    fail();
  });
});

test("[fail] a subtest two levels down calls t.skip() and then throws", async t => {
  await t.test("mid", async t2 => {
    await t2.test("leaf", t3 => {
      t3.skip();
      fail();
    });
  });
});

// `leaf` counts as skipped. It fails `mid`, and `mid` counts.
test("[fail] t.skip() over a subtest whose own subtest calls t.skip() and then throws", async t => {
  t.skip();
  await t.test("mid", async t2 => {
    await t2.test("leaf", t3 => {
      t3.skip();
      fail();
    });
  });
});

test("[fail] t.skip() after a failed test of an inline suite", async t => {
  describe("inner", () => {
    it("leaf", fail);
  });
  t.skip();
});

// No test fails here. The suite itself fails, and a failed suite counts.
test("[fail] t.skip() after an inline suite whose callback throws", t => {
  describe("inner", fail);
  t.skip();
});

// The skipped test fails the suite, and a failed suite counts.
describe("a suite", () => {
  it("[fail] t.skip() and then a throw, inside a suite", t => {
    t.skip();
    fail();
  });
});

test("[fail] t.skip() over a subtest that a throwing afterEach hook fails", async t => {
  t.afterEach(fail);
  await t.test("leaf", () => {});
  t.skip();
});

test("[fail] t.skip() over a subtest that a throwing before hook fails", async t => {
  t.before(fail);
  await t.test("leaf", () => {});
  t.skip();
});

test("[fail] t.skip() over an expectFailure subtest that passes", async t => {
  await t.test("leaf", { expectFailure: true }, () => {});
  t.skip();
});

// The subtest inherits expectFailure, passes, and so fails. The failed subtest
// is not the failure this test expects.
test("[fail] an expectFailure test whose subtest fails", { expectFailure: true }, async t => {
  await t.test("leaf", () => {});
});

// Node cancels a subtest that is not finished when its parent fails, and a
// cancelled test counts.
test("[fail] t.skip() and a throw while a subtest runs", t => {
  t.skip();
  t.test("leaf", () => {});
  throw new Error("top error");
});

test("[fail] a subtest calls t.todo() and throws while its own subtest runs", async t => {
  await t.test("mid", async t2 => {
    const { promise, resolve } = Promise.withResolvers();
    t2.test("leaf", () => promise);
    t2.todo();
    setImmediate(resolve);
    throw new Error("mid error");
  });
});
