const test = require("node:test");

// The example under "Extraneous asynchronous activity" in Node's documentation
// of node:test, without its second setImmediate() (an uncaught exception).
test("a test that creates asynchronous activity", t => {
  setImmediate(() => {
    t.test("subtest that is created too late", () => {
      throw new Error("error1");
    });
  });
  // The test finishes after this line.
});
