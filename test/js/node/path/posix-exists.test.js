import { test, describe } from "bun:test";
import assert from "node:assert";

describe("path.posix", () => {
  test("exists", () => {
    assert.strictEqual(require("path/posix"), require("path").posix);
  });
});
