// Node runs suites strictly sequentially, so an outer inline suite's `before`
// hook must finish before any descendant's body — even one nested another
// describe() deeper. All three tests pass verbatim on the node v26.3.0 binary.
const assert = require("node:assert");
const { test, describe, it, before } = require("node:test");

test("a nested test is gated on the outer suite's async before hook", () => {
  let setup = false;
  describe("outer", () => {
    before(async () => {
      await new Promise(resolve => setImmediate(resolve));
      setup = true;
    });
    describe("inner", () => {
      it("x", () => {
        assert.ok(setup, "outer before must run before x");
      });
    });
  });
});

test("a nested test is gated on the owning test's before hook too", t => {
  let setup = false;
  t.before(async () => {
    await new Promise(resolve => setImmediate(resolve));
    setup = true;
  });
  describe("outer", () => {
    describe("inner", () => {
      it("x", () => {
        assert.ok(setup, "the test's before must run before x");
      });
    });
  });
});

test("an outer suite's throwing before hook fails the test without running x", async t => {
  let ran = false;
  await t.test("child", { todo: true }, () => {
    describe("outer", () => {
      before(() => {
        throw new Error("boom");
      });
      describe("inner", () => {
        it("x", () => {
          ran = true;
        });
      });
    });
  });
  assert.strictEqual(ran, false);
});
