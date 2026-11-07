const { after, before, test } = require("node:test");
const assert = require("node:assert");

// A test is not finished while its afterEach and after hooks run. A subtest
// that a hook creates with t.test() is a subtest of that test.
const events = [];

test("a subtest from an after hook", t => {
  t.after(async () => {
    await t.test("from after", () => {
      events.push("from after");
    });
  });
});

test("a subtest from an afterEach hook", async t => {
  t.afterEach(async ctx => {
    // The hook runs for the subtest that it creates too.
    if (ctx.name !== "child") return;
    await ctx.test("from afterEach", () => {
      events.push("from afterEach");
    });
  });
  await t.test("child", () => {});
});

test("hooks that an after hook registers", t => {
  t.after(() => {
    before(() => events.push("before"));
    t.before(() => events.push("t.before"));
    after(() => events.push("after"));
    t.after(() => events.push("t.after"));
  });
});

// The timeout of a test is for its body. A hook can wait for a subtest for longer.
test("an after hook awaits a subtest for longer than the timeout of the test", { timeout: 50 }, t => {
  t.after(async () => {
    await t.test("slow", { timeout: 5000 }, () => new Promise(resolve => setTimeout(resolve, 150)));
    events.push("slow");
  });
});

// What a hook creates can register an after hook on the test. That hook runs too.
test("an after hook that a subtest from an after hook registers", t => {
  t.after(() => {
    t.test("first", () => {});
    t.test("second", () => {
      t.after(() => events.push("after from a subtest"));
    });
  });
});

test("an after hook that a before hook from an after hook registers", t => {
  t.after(() => {
    t.before(() => {
      t.after(() => events.push("after from a before hook"));
    });
  });
});

// What the hooks add does not change the result of a test that failed as expected.
test("an expected failure whose after hook registers a failing before hook", { expectFailure: true }, t => {
  t.after(() => {
    t.before(() => {
      throw new Error("from the before hook");
    });
  });
  throw new Error("expected");
});

// Node cancels what a hook leaves when the hooks are done. A test fails for a
// subtest that is cancelled, and not for a todo subtest or a hook.
test("an after hook leaves a todo subtest that is not finished", t => {
  t.after(() => {
    t.test("later", { todo: true }, () => new Promise(resolve => setTimeout(resolve, 20)));
  });
});

test("an after hook registers a before hook that needs time", t => {
  t.after(() => {
    t.before(() => new Promise(resolve => setTimeout(resolve, 20)));
  });
});

test("a subtest that is done or skipped is not one that a hook leaves", async t => {
  t.after(() => {
    t.test("skipped", { skip: true }, () => {});
    t.before(() => new Promise(resolve => setTimeout(resolve, 20)));
  });
  await t.test("done", () => {});
});

test("the hooks and their subtests ran", () => {
  assert.deepStrictEqual(events.slice(0, 2), ["from after", "from afterEach"]);
  // Node runs a before hook when it is registered. bun runs it in the order of the subtests of the test.
  assert.deepStrictEqual(events.slice(2, 6).sort(), ["after", "before", "t.after", "t.before"]);
  assert.deepStrictEqual(events.slice(6), ["slow", "after from a subtest", "after from a before hook"]);
});
