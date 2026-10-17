const { describe, it, test } = require("node:test");
const assert = require("node:assert");

// This file fails on purpose. Each test is a difference from Node that
// remains. The driver holds what bun does and what Node v26.3.0 does.
const events = [];

// Node gives a test from the global test() to the hook: it runs, and the file
// fails when it fails. bun does not run it. The owner of the hook passes on both.
test("the after hook of a test calls the global test()", t => {
  t.after(() => {
    test("created by the hook", () => {
      events.push("test from the global test()");
      throw new Error("from the test that the hook created");
    });
  });
});

test("the after hook of a test calls the global describe()", t => {
  t.after(() => {
    describe("created by the hook", () => {
      it("fails", () => {
        events.push("test from the global describe()");
        throw new Error("from the suite that the hook created");
      });
    });
  });
});

test("the after hook of a failed test calls the global test()", async t => {
  t.after(() => {
    test("created by the hook", () => {
      throw new Error("from the test that the hook created");
    });
  });
  await t.test("fails in the body", () => {
    throw new Error("from the body subtest");
  });
});

// Node has no t.describe().
test("t.describe() in an after hook", t => {
  t.after(async () => {
    await t.describe("suite from the hook", () => {
      it("fails", () => {
        throw new Error("from the suite of the hook");
      });
    });
  });
});

// Node runs a before hook when it is registered, and does not wait for it.
// bun waits for it as for a subtest, and it is not finished in time.
test("an after hook registers a before hook that needs time", t => {
  t.after(() => {
    t.before(() => new Promise(resolve => setTimeout(resolve, 20)));
  });
});

// Node starts the body of a subtest inside t.test(). bun starts it later.
test("an after hook closes what its subtest reads", t => {
  let open = true;
  t.after(() => {
    t.test("reads", () => {
      assert.ok(open, "closed before the subtest ran");
    });
    open = false;
  });
});

// Node keeps a subtest from a hook behind the subtest that a failed body left.
// bun starts it at once.
test("an after hook creates a subtest after a body that threw", t => {
  let release;
  const gate = new Promise(resolve => (release = resolve));
  t.after(async () => {
    const fromHook = t.test("from the hook", () => {
      events.push("from the hook");
    });
    await new Promise(resolve => setImmediate(resolve));
    release();
    await fromHook;
  });
  t.test("left by the body", async () => {
    await gate;
    events.push("left by the body");
  });
  throw new Error("from the body");
});

// The test passes on both: the subtest that is not finished is part of the
// expected failure. Node then fails the file.
test("an expected failure whose after hook leaves a subtest", { expectFailure: true }, t => {
  t.after(() => {
    t.test("does not settle", () => new Promise(() => {}));
  });
  throw new Error("expected");
});

process.on("exit", () => console.log("EVENTS " + JSON.stringify(events)));
