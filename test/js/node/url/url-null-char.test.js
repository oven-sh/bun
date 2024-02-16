import { describe, test } from "bun:test";
import assert from "node:assert";
import { URL } from "node:url";

describe("URL", () => {
  // TODO: Fix error properties
  test.skip("null character", () => {
    assert.throws(
      () => {
        new URL("a\0b");
      },
      { code: "ERR_INVALID_URL", input: "a\0b" },
    );
  });
});
