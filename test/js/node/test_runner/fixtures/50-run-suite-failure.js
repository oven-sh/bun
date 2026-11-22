// node-test.test.ts runs this through run() (run-events.js). The only failure
// that Node counts here is the inline suite: the tests are skipped.
const { test, describe, it } = require("node:test");

test("an inline suite fails below a test that calls t.skip()", async t => {
  describe("inline", () => {
    it("skips then throws", t2 => {
      t2.skip();
      throw new Error("suite test");
    });
  });
  t.skip();
});
