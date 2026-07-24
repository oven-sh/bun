const assert = require("node:assert");
const { test } = require("node:test");

test("a failing body is the expected outcome", { expectFailure: true }, () => {
  assert.fail("boom");
});

test("a label is allowed in place of true", { expectFailure: "known broken" }, () => {
  throw new Error("still broken");
});

test("a RegExp validates the error", { expectFailure: /boom/ }, () => {
  throw new Error("boom");
});

test("an object may carry both label and match", { expectFailure: { label: "x", match: /nope/ } }, () => {
  throw new Error("nope");
});
