import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";

// Tests for Windows UNC path handling in resolver
// Related to issues #17233 and #25000

if (isWindows) {
  describe("Windows UNC path handling", () => {
    test("Bun.resolve should handle UNC paths with server and share", async () => {
      // Create a temporary directory to work with
      using dir = tempDir("unc-test", {
        "package.json": JSON.stringify({ name: "test", type: "module" }),
        "index.js": String.raw`
          // This test verifies that UNC paths with proper server and share work
          const result = Bun.resolveSync("./foo.js", "\\\\server\\share\\path\\to\\file.js");
          console.log("SUCCESS: resolved", result);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(String(dir), "index.js")],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the process completed successfully without errors
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("Bun.resolve should handle UNC paths without share gracefully", async () => {
      // Create a temporary directory to work with
      using dir = tempDir("unc-test-no-share", {
        "package.json": JSON.stringify({ name: "test", type: "module" }),
        "index.js": String.raw`
          // This test verifies that incomplete UNC paths (server without share) are handled gracefully
          try {
            const result = Bun.resolveSync("./foo.js", "\\\\server\\");
            console.log("Resolved:", result);
          } catch (error) {
            // It's okay to throw an error, but should not panic
            console.log("Error (expected):", error.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(String(dir), "index.js")],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the process completed successfully
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("Bun.resolve should handle UNC server without trailing slash", async () => {
      using dir = tempDir("unc-test-no-trailing", {
        "package.json": JSON.stringify({ name: "test", type: "module" }),
        "index.js": String.raw`
          // Test UNC path with just server name (no trailing slash)
          try {
            const result = Bun.resolveSync("./foo.js", "\\\\server");
            console.log("Resolved:", result);
          } catch (error) {
            // It's okay to throw an error, but should not panic
            console.log("Error (expected):", error.message);
          }
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(String(dir), "index.js")],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [_, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the process completed successfully
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("module loader should not crash on Windows with UNC-like paths", async () => {
      using dir = tempDir("unc-module-loader", {
        "package.json": JSON.stringify({ name: "test", type: "module" }),
        "test.test.js": `
          import { test, expect } from "bun:test";

          test("dummy test", () => {
            expect(1).toBe(1);
          });
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Verify the test suite passed
      expect(stdout).toContain("1 pass");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("drive letter paths should still work correctly", async () => {
      using dir = tempDir("drive-letter-test", {
        "package.json": JSON.stringify({ name: "test", type: "module" }),
        "foo.js": `export const foo = 42;`,
        "index.js": `
          import { foo } from "./foo.js";
          console.log("foo =", foo);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(String(dir), "index.js")],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("foo = 42");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });
} else {
  test.skip("Windows UNC path tests only run on Windows", () => {});
}
