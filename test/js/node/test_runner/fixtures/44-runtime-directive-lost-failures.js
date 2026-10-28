// Node v26.3.0 exits 1 for each top-level test and suite of this file when it
// is alone in a file. A run-time t.skip() or t.todo() changes how that one test
// is counted. It does not hide a failure that Node counts somewhere else.
const { test, describe, it, before } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};

test("a subtest fails, then its parent calls t.skip()", async t => {
  await t.test("fails", fail("subtest"));
  t.skip();
});

test("a subtest fails, then its parent calls t.todo()", async t => {
  await t.test("fails", fail("subtest"));
  t.todo("the next case is not written");
});

test("a subtest fails, then its parent calls t.skip() and throws", async t => {
  await t.test("fails", fail("subtest"));
  t.skip();
  throw new Error("own");
});

// The callback of the subtest has no parameter, so `t` is the context of its parent.
test("a subtest calls the t.skip() of its parent and then fails", async t => {
  await t.test("fails", () => {
    t.skip("not supported here");
    throw new Error("subtest");
  });
});

test("two subtests fail, then their parent calls t.skip()", async t => {
  await t.test("fails first", fail("first"));
  await t.test("fails second", fail("second"));
  t.skip();
});

test("a subtest that is not awaited fails after its parent called t.skip()", t => {
  t.skip();
  t.test("fails", fail("subtest"));
});

describe("in a suite", () => {
  it("a subtest fails, then its parent calls t.skip()", async t => {
    await t.test("fails", fail("subtest"));
    t.skip();
  });
});

test("a subtest fails below a subtest that calls t.skip()", async t => {
  await t.test("skips itself", async t2 => {
    await t2.test("fails", fail("sub-subtest"));
    t2.skip();
  });
});

test("a subtest fails below a subtest that calls t.todo()", async t => {
  await t.test("marks itself todo", async t2 => {
    await t2.test("fails", fail("sub-subtest"));
    t2.todo();
  });
});

test("a subtest fails below a subtest that calls t.todo(), and the top test calls t.skip()", async t => {
  await t.test("marks itself todo", async t2 => {
    await t2.test("fails", fail("sub-subtest"));
    t2.todo();
  });
  t.skip();
});

// The top test fails by itself, so its own error is the one to print.
test("a subtest fails below a subtest that calls t.todo(), and the top test throws", async t => {
  await t.test("marks itself todo", async t2 => {
    await t2.test("fails", fail("sub-subtest"));
    t2.todo();
  });
  throw new Error("own");
});

test("an inline suite fails in its before hook, then the test calls t.skip()", async t => {
  describe("inline", () => {
    before(fail("suite hook"));
    it("never runs", () => {});
  });
  t.skip();
});

// The subtest never runs. Node fails it with the error of the hook.
test("a before hook of a test fails, then the test calls t.skip()", async t => {
  t.before(fail("test hook"));
  await t.test("never runs", () => {});
  t.skip();
});

test("a subtest calls t.skip() and then throws", async t => {
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

test("a subtest calls t.skip() with an unmet plan", async t => {
  await t.test("skips with a plan", t2 => {
    t2.plan(2);
    t2.skip();
  });
});

test("a subtest calls t.skip() and its after hook throws", async t => {
  await t.test("skips with a failing hook", t2 => {
    t2.after(fail("after hook"));
    t2.skip();
  });
});

test("a test of an inline suite calls t.skip() and then throws, and the top test calls t.skip()", async t => {
  describe("inline", () => {
    it("skips then throws", t2 => {
      t2.skip();
      throw new Error("suite test");
    });
  });
  t.skip();
});

// The after hook runs before the subtests are folded in, so it sees a test
// that passed and does not call t.todo().
test("a subtest calls t.skip() and throws, and the after hook of its parent reads t.passed", async t => {
  t.after(() => {
    if (!t.passed) t.todo();
  });
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

test("a subtest that expects a failure passes, then its parent calls t.skip()", async t => {
  await t.test("passes", { expectFailure: true }, () => {});
  t.skip();
});

// From https://github.com/nodejs/node/blob/v26.3.0/test/parallel/test-runner-xfail.js#L130-L140
// The test fails for not failing, and the second subtest fails by itself: a
// failed subtest is not the failure that its parent expects.
test("test level expectFailure with subtests", { expectFailure: true }, async t => {
  await t.test("subtest should pass if it throws", () => {
    throw new Error("fail");
  });

  await t.test("subtest should fail if it does not throw", () => {
    // This should fail the test because the suite expects failure,
    // and this subtest inherited that expectation but didn't throw.
  });
});
