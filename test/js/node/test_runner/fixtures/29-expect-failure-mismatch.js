const { test } = require("node:test");

test("the thrown error does not satisfy the validator", { expectFailure: /expected message/ }, () => {
  throw new Error("a different message entirely");
});
