const test = require("node:test");

// A subtest that an after hook creates counts for its parent: when it fails,
// the parent fails with "1 subtest failed".
test("a failing subtest from an after hook", t => {
  t.after(async () => {
    await t.test("fails", () => {
      throw new Error("from the after hook");
    });
  });
});

test("a later test still runs", () => {});
