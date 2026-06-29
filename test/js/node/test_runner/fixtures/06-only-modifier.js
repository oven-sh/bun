const test = require("node:test");
const assert = require("node:assert");

test.only("focused test", () => {
  assert.ok(true);
});

test("unfocused test", () => {
  assert.fail("must run when --only is not passed");
});
