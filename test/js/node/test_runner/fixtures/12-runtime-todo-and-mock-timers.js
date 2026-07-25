// Runtime t.todo()/t.skip() suppression and the runner's own timers staying
// real while mock timers are enabled, matched against Node v26.3.0.
const assert = require("node:assert");
const { test, describe } = require("node:test");

test("a runtime t.todo() suppresses a later failure", t => {
  t.todo("not implemented yet");
  throw new Error("expected failure under todo");
});

test("a runtime t.skip() suppresses a later failure", t => {
  t.skip("skipped at runtime");
  throw new Error("expected failure under skip");
});

test("an inline describe.todo() with a failing child does not fail the test", async () => {
  describe.todo("todo suite", () => {
    test("child", () => {
      throw new Error("child boom");
    });
  });
});

test("an inline describe with todo: true and a failing child does not fail the test", async () => {
  describe("todo option suite", { todo: true }, () => {
    test("child", () => {
      throw new Error("child boom");
    });
  });
});

test("t.waitFor uses real timers while mock timers are enabled", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ready = false;
  setImmediate(() => {
    ready = true;
  });
  await t.waitFor(
    () => {
      assert.ok(ready);
      return true;
    },
    { interval: 1, timeout: 1000 },
  );
  t.mock.timers.reset();
});
