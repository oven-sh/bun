const { test } = require("node:test");

// https://github.com/oven-sh/bun/pull/32631#discussion_r3541126497
// A t.test() that fulfills t.plan(N, {wait}) from an async callback is
// scheduled onto the parent's subtest chain during the plan wait. The parent
// must await it so a failing subtest fails the parent instead of passing.
test("p", t => {
  t.plan(1, { wait: true });
  setImmediate(() => {
    t.test("c", () => {
      throw new Error("boom");
    });
  });
});
