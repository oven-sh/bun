// Node v26.3.0 exits 1 for each top-level test of this file when it is alone in
// a file. A test starts a subtest, does not await it, and then fails in a way
// that t.skip(), t.todo() or expectFailure hides. Node cancels a subtest that
// has not finished by then, and counts the cancellation. Bun does not cancel:
// it lets the subtest finish, and the subtest counts if it fails.
const { test } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};
// The subtest needs a turn of the event loop to finish.
const failOnALaterTurn = message => async () => {
  await new Promise(resolve => setImmediate(resolve));
  throw new Error(message);
};

test("a test starts a failing subtest, calls t.skip() and throws", t => {
  t.test("fails", fail("subtest"));
  t.skip();
  throw new Error("own");
});

test("a test starts a failing subtest, calls t.todo() and throws", t => {
  t.test("fails", fail("subtest"));
  t.todo();
  throw new Error("own");
});

test("a subtest starts a failing subtest, calls t.todo() and throws", async t => {
  await t.test("marks itself todo", t2 => {
    t2.test("fails", fail("sub-subtest"));
    t2.todo();
    throw new Error("subtest");
  });
});

// The subtest inherits expectFailure and passes, so it fails by itself.
test("a test that expects a failure starts a subtest and throws", { expectFailure: true }, async t => {
  t.test("passes", () => {});
  await null;
  throw new Error("own");
});

test("a test starts a subtest that fails on a later turn, calls t.skip() and throws", t => {
  t.test("fails later", failOnALaterTurn("subtest"));
  t.skip();
  throw new Error("own");
});

test("a subtest starts a subtest that fails on a later turn, calls t.todo() and throws", async t => {
  await t.test("marks itself todo", t2 => {
    t2.test("fails later", failOnALaterTurn("sub-subtest"));
    t2.todo();
    throw new Error("subtest");
  });
});

test("a subtest starts a subtest that fails on a later turn and throws, and its after hook calls t.todo()", async t => {
  await t.test("todo from its after hook", t2 => {
    t2.after(() => t2.todo());
    t2.test("fails later", failOnALaterTurn("sub-subtest"));
    throw new Error("subtest");
  });
});

// The callback of the subtest has no parameter, so `t` is the context of its parent.
test("a test throws, and the subtest that it started calls the t.skip() of the test and fails", t => {
  t.test("fails", () => {
    t.skip();
    throw new Error("subtest");
  });
  throw new Error("own");
});

test("an async test throws, and the subtest that it started calls the t.todo() of the test and fails", async t => {
  t.test("fails", () => {
    t.todo();
    throw new Error("subtest");
  });
  throw new Error("own");
});

// Each subtest starts the next one on the same test, so the list of queued subtests grows while it runs.
test("subtests that were not awaited start more subtests on their parent, and the last one fails", t => {
  t.test("starts the second subtest", () => {
    t.test("starts the third subtest", () => {
      t.test("fails", fail("third subtest"));
    });
  });
  t.skip();
  throw new Error("own");
});

// The failure of this test counts, so nothing waits for its subtest.
test("a test throws while its subtest never settles", t => {
  t.test("never settles", () => new Promise(() => {}));
  throw new Error("own");
});
