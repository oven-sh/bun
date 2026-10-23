const { after, before, describe, it, test } = require("node:test");

// bun only: this file fails on purpose. A hook that times out is printed with
// the failure type of a hook failure, for each place that a hook can be in.
test("the after hook of a suite in a test times out", async () => {
  describe("suite", () => {
    after(() => new Promise(() => {}), { timeout: 5 });
    it("child", () => {});
  });
});

describe("the before hook of a top-level suite times out", () => {
  before(() => new Promise(() => {}), { timeout: 5 });
  it("child", () => {});
});

describe("the after hook of a top-level suite times out", () => {
  after(() => new Promise(() => {}), { timeout: 5 });
  it("child", () => {});
});
