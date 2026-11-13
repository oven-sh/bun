// A suite-level before() or after() hook runs as a bun:test beforeAll() or afterAll() hook that passes
// the failure to its done callback. Node v26.3.0 fails each suite below (failureType "hookFailed") and
// runs no test body under a failed before(). It reports those tests as cancelled ("cancelledByParent").
// bun test skips them and prints the failed hook.
const { describe, before, after, test } = require("node:test");

describe("after() throws", () => {
  after(() => {
    throw new Error("after() threw");
  });
  test("passes by itself", () => {});
});

describe("before() throws", () => {
  before(() => {
    throw new Error("before() threw");
  });
  test("must not run", () => {
    console.log("BODY RAN under before() throws");
  });
});

describe("before() rejects", () => {
  before(async () => {
    throw new Error("before() rejected");
  });
  test("must not run", () => {
    console.log("BODY RAN under before() rejects");
  });
});

describe("before() passes an error to done", () => {
  before((context, done) => {
    done(new Error("before() called done(err)"));
  });
  test("must not run", () => {
    console.log("BODY RAN under before() done(err)");
  });
});
