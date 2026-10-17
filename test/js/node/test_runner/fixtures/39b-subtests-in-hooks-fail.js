const test = require("node:test");

// This file fails on purpose. A subtest that is created before its parent is
// finished counts for the parent, also when a hook creates it.
test("a failing subtest from an after hook", t => {
  t.after(async () => {
    await t.test("fails", () => {
      throw new Error("from the after hook");
    });
  });
});

test("a failing subtest that the body creates after its own wait", t => {
  t.test("first", () => {}).then(() =>
    t.test("second", () => {
      throw new Error("from the second subtest");
    }),
  );
});

test("a failing subtest that follows a subtest from an after hook", t => {
  t.after(() => {
    t.test("first", () => {}).then(() =>
      t.test("second", () => {
        throw new Error("from the second subtest of the hook");
      }),
    );
  });
});

test("failing subtests from the body and from an after hook", async t => {
  t.after(async () => {
    await t.test("fails in the hook", () => {
      throw new Error("from the after hook");
    });
  });
  await t.test("fails in the body", () => {
    throw new Error("from the body");
  });
});

test("a failing before hook that an after hook registers", t => {
  t.after(() => {
    t.before(() => {
      throw new Error("from the before hook");
    });
  });
});

test("the body throws and a subtest from an after hook fails", t => {
  t.after(async () => {
    await t.test("fails in the hook", () => {
      throw new Error("from the after hook");
    });
  });
  throw new Error("from the body");
});

// Node cancels a subtest that is not finished when the hooks of its parent are done. The parent fails for it.
test("a subtest from an after hook that does not settle", t => {
  t.after(() => {
    t.test("does not settle", () => new Promise(() => {}));
  });
});

test("a later test still runs", () => {});
