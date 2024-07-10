import { describe, test } from "bun:test";
import assert from "node:assert";
import url from "node:url";

describe("url.format", () => {
  // TODO: Support error code.
  test.todo("invalid input", () => {
    const throwsObjsAndReportTypes = [undefined, null, true, false, 0, function () {}, Symbol("foo")];

    for (const urlObject of throwsObjsAndReportTypes) {
      assert.throws(
        () => {
          url.format(urlObject);
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: 'The "urlObject" argument must be one of type object or string.',
        },
      );
    }
  });

  test("empty", () => {
    assert.strictEqual(url.format(""), "");
    assert.strictEqual(url.format({}), "");
  });
});
