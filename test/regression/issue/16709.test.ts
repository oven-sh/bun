import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import path from "node:path";

// Regression test for issue #16709: Bun Glob does not work with absolute paths
// See: https://github.com/oven-sh/bun/issues/16709
describe("Bun.Glob absolute paths issue #16709", () => {
  test("should find files with absolute paths", async () => {
    // Create a temporary directory with a test file
    const tempdir = tempDirWithFiles("glob-absolute-test", {
      "foo": "test content",
      "bar.txt": "bar content",
      "nested": {
        "baz.js": "baz content",
      },
    });

    // Test 1: Simple absolute path (literal, no glob patterns)
    const absolutePath = path.join(tempdir, "foo");
    const glob1 = new Bun.Glob(absolutePath);
    const results1 = await Array.fromAsync(glob1.scan());
    expect(results1).toHaveLength(1);
    expect(results1[0]).toBe(absolutePath);

    // Test 2: Absolute path with wildcard
    const absolutePattern = path.join(tempdir, "ba*");
    const glob2 = new Bun.Glob(absolutePattern);
    const results2 = await Array.fromAsync(glob2.scan());
    expect(results2).toHaveLength(1);
    expect(results2[0]).toBe(path.join(tempdir, "bar.txt"));

    // Test 3: Absolute path with nested wildcard
    const nestedPattern = path.join(tempdir, "**", "*.js");
    const glob3 = new Bun.Glob(nestedPattern);
    const results3 = await Array.fromAsync(glob3.scan());
    expect(results3).toHaveLength(1);
    expect(results3[0]).toBe(path.join(tempdir, "nested", "baz.js"));

    // Test 4: Compare with relative equivalent to ensure behavior difference
    const relativeGlob = new Bun.Glob("foo");
    const relativeResults = await Array.fromAsync(relativeGlob.scan({ cwd: tempdir }));
    expect(relativeResults).toHaveLength(1);
    expect(relativeResults[0]).toBe("foo"); // relative result
  });

  test("should handle non-existent absolute paths gracefully", async () => {
    const nonExistentPath = path.join("/tmp", "definitely-does-not-exist-" + Date.now());
    const glob = new Bun.Glob(nonExistentPath);
    const results = await Array.fromAsync(glob.scan());
    expect(results).toHaveLength(0);
  });
});
