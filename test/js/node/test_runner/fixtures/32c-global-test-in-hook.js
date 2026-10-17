const { after, describe, it, test } = require("node:test");

// bun only: Node attaches a test that a hook creates with the global test()
// to the hook. The owner of the hook passes on both runtimes. Node fails the
// file for that test, and bun does not run it.
test("the after hook of a test creates a test", t => {
  t.after(() => {
    test("created by the hook", () => {
      throw new Error("from the test that the hook created");
    });
  });
});

test("the after hook of a test creates a suite", t => {
  t.after(() => {
    describe("created by the hook", () => {
      it("fails", () => {
        throw new Error("from the suite that the hook created");
      });
    });
  });
});

test("the after hook of a suite creates a test", () => {
  describe("suite", () => {
    after(() => {
      test("created by the hook", () => {
        throw new Error("from the test that the hook created");
      });
    });
    it("child", () => {});
  });
});
