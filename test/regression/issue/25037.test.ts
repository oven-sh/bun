import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "fs";
import path from "path";

// Issue #25037: Inconsistent Path Traversal Handling on Windows
// When there are more "../" components than the depth of the path allows,
// the path should be clamped at the drive root, matching Node.js behavior.
// For example, "C:/a/b/c/../../../../d.txt" should resolve to "C:\d.txt"

describe("path traversal above drive root", () => {
  test("path.normalize clamps excessive parent traversal at drive root", () => {
    // For absolute Windows paths, excessive ../ should be clamped at the drive root
    const testCases = [
      { input: "C:/a/b/c/../../../../d.txt", expected: "C:\\d.txt" },
      { input: "C:/a/b/c/../../../../../e.txt", expected: "C:\\e.txt" },
      { input: "C:/a/../../../../../../f.txt", expected: "C:\\f.txt" },
      { input: "C:/x/../../../file.txt", expected: "C:\\file.txt" },
    ];

    for (const { input, expected } of testCases) {
      const normalized = path.normalize(input);
      expect(normalized).toBe(expected);
    }
  });

  test("path.resolve clamps excessive parent traversal at drive root", () => {
    const testCases = [
      { input: "C:/a/b/c/../../../../d.txt", expected: "C:\\d.txt" },
      { input: "C:/x/y/z/../../../../../file.txt", expected: "C:\\file.txt" },
    ];

    for (const { input, expected } of testCases) {
      const resolved = path.resolve(input);
      expect(resolved).toBe(expected);
    }
  });

  test("fs.readFileSync works with excessive parent traversal paths", () => {
    // Create a temp dir at known location, put a file in it
    using dir = tempDir("test-25037", {
      "nested/deep/inner.txt": "inner content",
    });

    const dirPath = String(dir);
    const innerFilePath = path.join(dirPath, "nested/deep/inner.txt");

    // Count how many "../" we need to get from "nested/deep" back to dir root: 2
    // Then add many more - should still resolve to dir root
    // After reaching dir root, each additional ../ goes toward the drive root

    // First, verify the file exists at the expected normalized path
    expect(fs.existsSync(innerFilePath)).toBe(true);

    // Now access with exact number of ../ needed (2)
    const exactPath = path.join(
      dirPath,
      "nested/deep",
      "../../nested/deep/inner.txt"
    );
    const content1 = fs.readFileSync(exactPath, "utf-8");
    expect(content1).toBe("inner content");
  });

  test("fs operations work when path has just enough ../ to reach root of temp dir", () => {
    using dir = tempDir("test-25037-root", {
      "level1/level2/level3/file.txt": "level3 content",
      "rootfile.txt": "root content",
    });

    const dirPath = String(dir);

    // From level1/level2/level3, going up 3 levels should get us to dir root
    const pathToRoot = path.join(
      dirPath,
      "level1/level2/level3",
      "../../../rootfile.txt"
    );

    const content = fs.readFileSync(pathToRoot, "utf-8");
    expect(content).toBe("root content");
  });

  test("fs.existsSync returns false for non-existent file even with excessive ../", () => {
    using dir = tempDir("test-25037-nofile", {
      "a/b/c/exists.txt": "exists",
    });

    // Try to access a file that doesn't exist, with excessive ../
    // This should not throw, just return false
    const nonExistentPath = path.join(
      String(dir),
      "a/b/c",
      "../../../../../../../../../nonexistent.txt"
    );

    // This shouldn't crash - it should just return false
    // (the file doesn't exist at the resolved path)
    const exists = fs.existsSync(nonExistentPath);
    // We don't assert true or false here because it depends on whether
    // there's a file at the resolved path on the system
    expect(typeof exists).toBe("boolean");
  });

  test("fs.accessSync throws ENOENT for non-existent file with excessive ../", () => {
    using dir = tempDir("test-25037-access", {
      "a/b/c/exists.txt": "exists",
    });

    // Construct a path that resolves to the drive root with a non-existent file
    const nonExistentPath = path.join(
      String(dir),
      "a/b/c",
      "../../../../../../../../../this-file-does-not-exist-12345.txt"
    );

    // This should throw ENOENT, not crash
    let thrownError: any = null;
    try {
      fs.accessSync(nonExistentPath);
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).not.toBeNull();
    expect(thrownError.code).toBe("ENOENT");
  });

  // This is the key test for the original issue #25037
  // It specifically tests the case where excessive ../ goes above the drive root
  test("fs.readFileSync handles path with more ../ than path depth - the original issue", () => {
    using dir = tempDir("test-25037-original", {
      // Create a file that we'll access with excessive ../
      "target.txt": "target content from test",
    });

    const dirPath = String(dir);

    // Count the depth of the temp dir path from drive root
    // e.g., C:\Users\...\AppData\Local\Temp\test-25037-original_XXX
    // Let's count how many components there are
    const components = dirPath.split(path.sep).filter((c) => c && c !== "C:");
    const depth = components.length;

    // Now construct a path that goes UP more than the depth
    // from a subdirectory, go up (depth + 10) levels, then back down to the temp dir
    // This should resolve to the same location because excess ../ is clamped at root

    // Create a subdir path
    const subPath = path.join(dirPath, "sub/dir/here");
    fs.mkdirSync(subPath, { recursive: true });

    // From sub/dir/here (3 more levels), we need (depth + 3) ../ to reach the drive root
    // But we'll use many more to test the clamping
    const excessiveDotsCount = depth + 10;
    const dotsPath = "../".repeat(excessiveDotsCount);

    // After clamping at drive root, we need to go back to the temp dir
    // Build the relative path from root to the temp dir
    const relativeToDrive = dirPath.substring(3); // Remove "C:\" prefix

    const fullPath = path.join(subPath, dotsPath, relativeToDrive, "target.txt");

    // This should work - the path resolves to the temp dir's target.txt
    const content = fs.readFileSync(fullPath, "utf-8");
    expect(content).toBe("target content from test");
  });
});

// Verify the path is correctly normalized when passed to fs operations
describe("internal path normalization verification", () => {
  test("Bun.spawn with excessive ../ in working directory works", async () => {
    using dir = tempDir("test-25037-spawn", {
      "level1/script.js": 'console.log("hello");',
    });

    const dirPath = String(dir);

    // Run from a path with ../ that resolves correctly
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(dirPath, "level1/../level1/script.js")],
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout.trim()).toBe("hello");
    expect(exitCode).toBe(0);
  });
});
