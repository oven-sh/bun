const { describe, before, test } = require("node:test");

describe("db suite", () => {
  before(() => {
    throw new Error("DB connection failed");
  });
  test("reads row", () => {
    // would touch the DB; must not be reported as a pass
  });
});
