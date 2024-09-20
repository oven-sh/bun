import { describe, test } from "bun:test";
import assert from "node:assert";
import path from "node:path";

const isWindows = process.platform === "win32";

describe("path.posix.relative", () => {
  test.skipIf(!isWindows)("on windows", () => {
    // Refs: https://github.com/nodejs/node/issues/13683

    const relativePath = path.posix.relative("a/b/c", "../../x");
    assert.match(relativePath, /^(\.\.\/){3,5}x$/);
  });
});
