const test = require("node:test");
const assert = require("node:assert");
const { describe } = test;

describe("focused suite", { only: true }, () => {
  test("test in focused suite", () => {
    assert.ok(true);
  });
});

describe("unfocused suite", () => {
  test("test in unfocused suite", () => {
    assert.fail("must run when --only is not passed");
  });
});
