// Suite-level before()/after() hooks run as bun:test beforeAll/afterAll hooks
// that report a failure through their done callback. Node v26.3.0 fails both
// suites and does not run the body under the failing before().
const { describe, before, after, test } = require("node:test");

describe("suite whose after() fails", () => {
  after(() => {
    throw new Error("suite after() failed");
  });
  test("passes on its own", () => {});
});

describe("suite whose before() fails", () => {
  before(() => {
    throw new Error("suite before() failed");
  });
  test("must not run", () => {
    console.log("BODY_RAN_AFTER_FAILED_BEFORE");
  });
});
