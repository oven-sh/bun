const test = require("node:test");

// This file fails on purpose. bun waits for a subtest that nothing awaits,
// and Node cancels it. The test fails on both runtimes.
test("a subtest from an after hook that does not settle", { timeout: 50 }, t => {
  t.after(() => {
    t.test("does not settle", () => new Promise(() => {}));
  });
});

test("a body that throws does not wait for its subtest", t => {
  t.test("does not settle", () => new Promise(() => {}));
  throw new Error("from the body");
});

test("a later test still runs", () => {});
