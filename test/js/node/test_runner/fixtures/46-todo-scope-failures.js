// node-test.test.ts runs this with `--todo`. Node v26.3.0 exits 0 for this file:
// each test is todo, and each subtest of a todo test inherits that. Under
// `bun test --todo` a todo test has to fail, so bun:test must hear of a failure
// below the test that Node does not count.
const { test, describe, it } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};

test("a todo test whose subtest fails", { todo: true }, async t => {
  await t.test("inherits todo and fails", fail("subtest"));
});

test.todo("a test.todo() whose sub-subtest fails", async t => {
  await t.test("inherits todo", async t2 => {
    await t2.test("inherits todo and fails", fail("sub-subtest"));
  });
});

// A test that is todo and skipped reports as skipped, as in Node.
test.todo("a test.todo() that calls t.skip() after its subtest failed", async t => {
  await t.test("inherits todo and fails", fail("subtest"));
  t.skip();
});

test("a todo test whose todo subtest fails", { todo: true }, async t => {
  await t.test("declared todo and fails", { todo: true }, fail("subtest"));
});

test("a todo test whose subtest calls t.todo() and throws", { todo: true }, async t => {
  await t.test("todo then throws", t2 => {
    t2.todo();
    throw new Error("subtest");
  });
});

test("a todo test whose subtest calls t.skip() and throws", { todo: true }, async t => {
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

describe("a todo suite", { todo: true }, () => {
  it("whose test has a failing subtest", async t => {
    await t.test("inherits todo and fails", fail("subtest"));
  });
});

// The subtest inherits todo, so it cannot fail the run and nothing waits for it.
test.todo("a test.todo() that throws while its subtest never settles", t => {
  t.test("inherits todo", () => new Promise(() => {}));
  throw new Error("own");
});

test("a todo test whose subtests all pass", { todo: true }, async t => {
  await t.test("passes", () => {});
});
