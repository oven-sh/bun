// Node v26.3.0 exits 0 for this file, and for each top-level test and suite of
// it alone. None of these failures counts in Node.
const { test, describe, it, before, afterEach } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};
const neverSettles = () => new Promise(() => {});
const skipsAndNeverSettles = t => {
  t.skip();
  return neverSettles();
};

test("a subtest calls t.todo() and then throws", async t => {
  await t.test("todo then throws", t2 => {
    t2.todo();
    throw new Error("subtest");
  });
});

test("a subtest calls t.todo() with an unmet plan", async t => {
  await t.test("todo with a plan", t2 => {
    t2.plan(2);
    t2.todo();
  });
});

test("a subtest calls t.todo() and its after hook throws", async t => {
  await t.test("todo with a failing hook", t2 => {
    t2.after(fail("after hook"));
    t2.todo();
  });
});

// The hook that calls t.todo() runs first, so the test is todo when the next hook fails.
test("an after hook of a subtest calls t.todo(), and the next one throws", async t => {
  await t.test("todo from a hook", t2 => {
    t2.after(() => t2.todo());
    t2.after(fail("after hook"));
  });
});

test("an after hook of a test calls t.todo(), and the next one throws", t => {
  t.after(() => t.todo());
  t.after(fail("after hook"));
});

// Node runs the after hooks of a test after one of its afterEach hooks failed.
describe("an afterEach hook throws", () => {
  afterEach(fail("afterEach hook"));
  it("and an after hook of the test calls t.todo()", t => {
    t.after(() => t.todo());
  });
});

test("a subtest calls t.todo(), then its own subtest fails", async t => {
  await t.test("todo first", async t2 => {
    t2.todo();
    await t2.test("inherits todo and fails", fail("sub-subtest"));
  });
});

test("a test of an inline suite calls t.todo() and then throws", async t => {
  describe("inline", () => {
    it("todo then throws", t2 => {
      t2.todo();
      throw new Error("suite test");
    });
  });
});

test("an inline todo suite fails in its before hook", async t => {
  describe("inline", { todo: true }, () => {
    before(fail("suite hook"));
    it("never runs", () => {});
  });
});

test("a test of an inline describe.todo() suite fails", async () => {
  describe.todo("inline", () => {
    it("inherits todo and fails", fail("suite test"));
  });
});

test("test.todo() fails inside a test", async () => {
  await test.todo("todo subtest", fail("subtest"));
});

test("it.todo() fails inside an inline suite", async () => {
  describe("inline", () => {
    it.todo("todo test of an inline suite", fail("suite test"));
  });
});

test("a test calls t.todo(), then its subtest fails", async t => {
  t.todo();
  await t.test("inherits todo and fails", fail("subtest"));
});

test("a test calls t.skip() and throws after its subtest called t.skip() and threw", async t => {
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
  t.skip();
  throw new Error("own");
});

test("a todo subtest fails, then its parent calls t.skip()", async t => {
  await t.test("declared todo", { todo: true }, fail("subtest"));
  t.skip();
});

test("a subtest that expects a failure throws, then its parent calls t.skip()", async t => {
  await t.test("throws as expected", { expectFailure: true }, fail("subtest"));
  t.skip();
});

// The failure of the suite is the one that the suite expects.
test("an inline suite that expects a failure throws, then the test calls t.skip()", async t => {
  describe("inline", { expectFailure: true }, () => {
    throw new Error("suite");
  });
  t.skip();
});

// The inline suite inherits the expectation of the test.
test("a test that expects a failure throws after its inline suite threw", { expectFailure: true }, async t => {
  describe("inline", () => {
    throw new Error("suite");
  });
  throw new Error("own");
});

// The inner subtest inherits the expectation and does not match it. Its rollup
// is the failure that the skipped subtest expects.
test("a skipped subtest expects a failure, and its own subtest calls t.skip() and throws", async t => {
  await t.test("skipped, expects a failure", { expectFailure: /subtest/ }, async t2 => {
    t2.skip();
    await t2.test("skips then throws", t3 => {
      t3.skip();
      throw new Error("no match");
    });
  });
});

// The test already has the failure that it expects, so its subtest adds none.
test(
  "a test throws its expected failure after its subtest called t.skip() and threw",
  { expectFailure: /expected/ },
  async t => {
    await t.test("skips then throws", t2 => {
      t2.skip();
      throw new Error("subtest");
    });
    throw new Error("expected");
  },
);

// Node reads the directive of a subtest when the parent finishes.
test("a subtest calls t.skip() and throws, then its parent calls todo() on it", async t => {
  let subtest;
  await t.test("skips then throws", t2 => {
    subtest = t2;
    t2.skip();
    throw new Error("subtest");
  });
  subtest.todo();
});

// The after hook runs before the subtests are folded in, so it sees a test
// that passed and calls t.todo().
test("a subtest calls t.skip() and throws, and the after hook of its parent calls t.todo()", async t => {
  t.after(() => {
    if (t.passed) t.todo();
  });
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

// A subtest that is todo cannot fail the run, so nothing waits for it.
test("a test calls t.todo() and throws while its subtest never settles", t => {
  t.todo();
  t.test("inherits todo", neverSettles);
  throw new Error("own");
});

test("a test calls t.skip() and throws while its todo subtest never settles", t => {
  t.test("declared todo", { todo: true }, neverSettles);
  t.skip();
  throw new Error("own");
});

test("a test calls t.skip() and throws while a test of its inline todo suite never settles", t => {
  describe("inline", { todo: true }, () => {
    it("inherits todo", neverSettles);
  });
  t.skip();
  throw new Error("own");
});

// A test with a timeout waits for a subtest only until that timeout ends. Node
// cancels the subtest at once, and a subtest that called t.skip() stays skipped.
test("a test with a timeout calls t.skip() and throws while its subtest never settles", { timeout: 20 }, t => {
  t.test("skips and never settles", skipsAndNeverSettles);
  t.skip();
  throw new Error("own");
});

test("a test that called t.skip() times out while its subtest never settles", { timeout: 20 }, async t => {
  t.skip();
  t.test("skips and never settles", skipsAndNeverSettles);
  await neverSettles();
});

test("a test with a timeout throws, and its after hook calls t.skip(), while its subtest never settles", { timeout: 20 }, t => {
  t.after(() => t.skip());
  t.test("skips and never settles", skipsAndNeverSettles);
  throw new Error("own");
});

test("a test with a timeout throws, and its subtest calls the t.skip() of the test and never settles", { timeout: 20 }, t => {
  t.test("skips and never settles", t2 => {
    t.skip();
    return skipsAndNeverSettles(t2);
  });
  throw new Error("own");
});

// The subtest runs before the after hook of the test, as it does in Node.
test("a test calls t.todo() and throws, and its after hook closes what its subtest reads", t => {
  let open = true;
  t.after(() => {
    open = false;
  });
  t.test("reads", () => {
    if (!open) throw new Error("closed");
  });
  t.todo("writes are not implemented");
  throw new Error("own");
});

describe("a suite", () => {
  it("whose test calls t.todo() and t.skip() and then throws", t => {
    t.todo();
    t.skip();
    throw new Error("own");
  });

  it("whose test calls t.todo() and then throws", t => {
    t.todo();
    throw new Error("own");
  });
});
