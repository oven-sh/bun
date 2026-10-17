// Every failure here must still be reported. User code replaced the global
// reportError before node:test loaded, as a setup file can do.
globalThis.reportError = () => {};
const { test, describe, before } = require("node:test");

test("a body that throws", () => {
  throw new Error("boom");
});

describe("a suite whose before hook throws", () => {
  before(() => {
    throw new Error("hook boom");
  });
  test("child", () => {});
});
