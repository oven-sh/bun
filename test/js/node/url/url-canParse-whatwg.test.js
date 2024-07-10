import { describe, test } from "bun:test";
import assert from "node:assert";
import { URL } from "node:url";

describe("URL.canParse", () => {
  // TODO: Support error code.
  test.todo("invalid input", () => {
    // One argument is required
    assert.throws(
      () => {
        URL.canParse();
      },
      {
        code: "ERR_MISSING_ARGS",
        name: "TypeError",
      },
    );
  });

  test("repeatedly called produces same result", () => {
    // This test is to ensure that the v8 fast api works.
    for (let i = 0; i < 1e5; i++) {
      assert(URL.canParse("https://www.example.com/path/?query=param#hash"));
    }
  });
});
