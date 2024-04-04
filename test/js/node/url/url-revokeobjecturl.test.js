import { describe, test } from "bun:test";
import assert from "node:assert";
import { URL } from "node:url";

// TODO: Support throwing appropriate error.
describe.todo("URL.revokeObjectURL", () => {
  test("invalid input", () => {
    // Test ensures that the function receives the url argument.
    assert.throws(
      () => {
        URL.revokeObjectURL();
      },
      {
        code: "ERR_MISSING_ARGS",
        name: "TypeError",
      },
    );
  });
});
