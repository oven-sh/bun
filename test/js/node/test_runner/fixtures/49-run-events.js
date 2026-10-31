// node-test.test.ts runs this through run() (run-events.js) and compares the
// events with the ones that Node v26.3.0 emits for this file.
const { test, describe, it, before, after } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};

test("a subtest fails, then its parent calls t.skip()", async t => {
  await t.test("fails", fail("subtest"));
  t.skip();
});

test("a subtest calls t.skip() and then throws", async t => {
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

test("a subtest calls t.todo() and then throws", async t => {
  await t.test("todo then throws", t2 => {
    t2.todo();
    throw new Error("subtest");
  });
});

test("a subtest fails below a subtest that calls t.todo()", async t => {
  await t.test("marks itself todo", async t2 => {
    await t2.test("fails below", fail("sub-subtest"));
    t2.todo();
  });
});

// Each subtest gets the error of the hook as its own failure.
test("a before hook of a test fails", async t => {
  t.before(fail("test hook"));
  await t.test("never runs", () => {});
  await t.test("never runs, expects a failure", { expectFailure: true }, () => {});
});

test("a test of an inline suite fails", async () => {
  describe("inline, member", () => {
    it("member fails", fail("suite test"));
  });
});

test("an inline suite fails in its after hook", async () => {
  describe("inline, after hook", () => {
    after(fail("suite hook"));
    it("member passes", () => {});
  });
});

// The failure of the hook is the failure of the suite, not "1 subtest failed".
test("an inline suite fails in its after hook and has a failing member", async () => {
  describe("inline, after hook and member", () => {
    after(fail("suite hook"));
    it("member fails first", fail("suite test"));
  });
});

test("an inline todo suite has a failing member, and the test calls t.skip()", async t => {
  describe("inline todo", { todo: true }, () => {
    it("todo member fails", fail("suite test"));
  });
  t.skip();
});

test("a todo test whose subtest fails", { todo: true }, async t => {
  await t.test("inherits todo and fails", fail("subtest"));
});

test.todo("a test.todo() whose subtest fails", async t => {
  await t.test("inherits todo and fails too", fail("subtest"));
});

test("a test starts a failing subtest, calls t.skip() and throws", t => {
  t.test("queued, fails", fail("subtest"));
  t.skip();
  throw new Error("own");
});
