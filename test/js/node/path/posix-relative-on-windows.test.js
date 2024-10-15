import { describe, test } from "bun:test";
import { isWindows } from "harness";
import assert from "node:assert";
import path from "node:path";

describe("path.posix.relative", () => {
  test.skipIf(!isWindows)("on windows", () => {
    // Refs: https://github.com/nodejs/node/issues/13683

    const relativePath = path.posix.relative("a/b/c", "../../x");
    assert.match(relativePath, /^(\.\.\/){3,5}x$/);
  });
});
