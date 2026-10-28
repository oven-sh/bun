// Node v26.3.0 counts no failure in any of these tests, so the run is green.
// A test that did not pass is excused when it is skipped or todo itself, and a
// subtest created after t.todo() inherits todo. The tag in each name is the
// label `bun test` gives the top-level test.
const { describe, it, test } = require("node:test");

const fail = () => {
  throw new Error("leaf error");
};

test("[skip] t.skip() and then a throw", t => {
  t.skip();
  fail();
});

test("[todo] t.todo() and then a throw", t => {
  t.todo();
  fail();
});

test("[skip] t.skip() and a throwing after hook", t => {
  t.after(fail);
  t.skip();
});

test("[skip] t.skip() after a passing subtest", async t => {
  await t.test("leaf", () => {});
  t.skip();
});

test("[todo] t.todo() after a passing subtest", async t => {
  await t.test("leaf", () => {});
  t.todo();
});

test("[skip] t.skip() after a failed subtest that has its own todo", async t => {
  await t.test("leaf", { todo: true }, fail);
  t.skip();
});

test("[skip] t.skip() after a failed test of an inline todo suite", async t => {
  describe("inner", { todo: true }, () => {
    it("leaf", fail);
  });
  t.skip();
});

test("[skip] t.skip() over an expectFailure subtest that throws", async t => {
  await t.test("leaf", { expectFailure: true }, fail);
  t.skip();
});

// The before hook fails this test and its subtest. The test is skipped, and
// the subtest expects a failure.
test("[skip] t.skip() over an expectFailure subtest that a throwing before hook fails", async t => {
  t.before(fail);
  await t.test("leaf", { expectFailure: true }, () => {});
  t.skip();
});

// The subtest counts as skipped. It fails this test, which is skipped or todo.
test("[skip] t.skip() after a subtest that calls t.skip() and then throws", async t => {
  await t.test("leaf", t2 => {
    t2.skip();
    fail();
  });
  t.skip();
});

test("[todo] t.todo() after a subtest that calls t.skip() and then throws", async t => {
  await t.test("leaf", t2 => {
    t2.skip();
    fail();
  });
  t.todo();
});

// From here on each failed subtest is todo, by its own call or by inheritance.
test("[todo] t.todo() before a failed subtest", async t => {
  t.todo();
  await t.test("leaf", fail);
});

test("[todo] t.todo() before a failed test of an inline suite", async t => {
  t.todo();
  describe("inner", () => {
    it("leaf", fail);
  });
});

test("[todo] t.todo() before a subtest that outlasts the test's timeout", { timeout: 1 }, async t => {
  t.todo();
  await t.test("leaf", () => new Promise(() => {}));
});

test("[pass] a subtest calls t.todo() and then throws", async t => {
  await t.test("leaf", t2 => {
    t2.todo();
    fail();
  });
});

test("[pass] a subtest calls t.todo() before its own subtest fails", async t => {
  await t.test("mid", async t2 => {
    t2.todo();
    await t2.test("leaf", fail);
  });
});

test("[pass] a subtest calls t.todo() before a failed test of an inline suite", async t => {
  await t.test("mid", async t2 => {
    t2.todo();
    describe("inner", () => {
      it("leaf", fail);
    });
  });
});

// bun:test runs a declared todo only under --todo, and then wants it to fail.
test("[todo] a declared todo with a failed subtest", { todo: true }, async t => {
  await t.test("leaf", fail);
});

test("[todo] a declared todo whose subtest calls t.skip() and then throws", { todo: true }, async t => {
  await t.test("leaf", t2 => {
    t2.skip();
    fail();
  });
});

// Under --todo the body runs, and t.skip() wins over todo as in Node.
test.todo("[todo] test.todo() with a failed subtest and t.skip()", async t => {
  await t.test("leaf", fail);
  t.skip();
});
