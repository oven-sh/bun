// Node cancels a test that its own timeout or the wait of its plan ends. The
// test still gets the verdict of `expectFailure`, and the cancel fails the run.
// node-test.test.ts has the lines that node v26.3.0 prints for this file.
const { test, describe, beforeEach } = require("node:test");

const never = () => new Promise(() => {});

test("own timeout", { timeout: 50, expectFailure: true }, never);

test("plan wait", { expectFailure: true }, t => {
  t.plan(1, { wait: 50 });
});

// The timeout of a hook is an ordinary failure, not a cancel.
describe("hook timeout", () => {
  beforeEach(never, { timeout: 50 });

  test("test", { expectFailure: true }, () => {});
});

// A subtest inherits `expectFailure`. Its cancel is not a failure that the
// parent can take as its own expected one.
test("parent expects, subtest own timeout", { expectFailure: true }, async t => {
  await t.test("subtest", { timeout: 50 }, never);
});

test("parent expects, subtest plan wait", { expectFailure: true }, async t => {
  await t.test("subtest", t2 => {
    t2.plan(1, { wait: 50 });
  });
});

describe("suite expects", { expectFailure: true }, () => {
  test("subtest own timeout", async t => {
    await t.test("subtest", { timeout: 50 }, never);
  });
});

test("only the subtest expects", async t => {
  await t.test("subtest", { timeout: 50, expectFailure: true }, never);
});

// Node counts a todo test as todo before it looks at the cancel.
test("todo subtest own timeout", async t => {
  await t.test("subtest", { timeout: 50, todo: true }, never);
});
