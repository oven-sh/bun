import { test, expect } from "bun:test";
import { tempDirWithFiles, bunEnv, bunExe } from "harness";

test("ResolveMessage JSON.stringify should not cause heap-use-after-free and should extend Error", async () => {
  // Create a temporary directory with test files
  const tempDir = tempDirWithFiles("resolve-message-test", {
    "index.js": `
      try {
        // This should fail to resolve and create a ResolveMessage
        require("./nonexistent-module");
      } catch (error) {
        // Verify it extends Error
        console.log("instanceof Error:", error instanceof Error);
        // Try to JSON.stringify the error to trigger the heap-use-after-free
        console.log("Error caught:", JSON.stringify(error));
        process.exit(0);
      }
    `,
  });

  // Run the test file with Bun
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // The test passes if we don't get an ASAN error and the process exits normally
  // In the past, this would cause a heap-use-after-free error
  expect(exitCode).toBe(0);
  expect(stdout).toContain("instanceof Error: true");
  expect(stdout).toContain("Error caught:");
  
  // Make sure we don't have any ASAN errors in stderr
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("heap-use-after-free");
});

test("ResolveMessage toJSON should handle missing referrer gracefully", async () => {
  const tempDir = tempDirWithFiles("resolve-message-missing-referrer", {
    "index.js": `
      // Test dynamic import that fails
      import("./does-not-exist").catch(error => {
        // Verify it extends Error
        console.log("instanceof Error:", error instanceof Error);
        // This should not crash when JSON.stringify is called on the resolve error
        try {
          const json = JSON.stringify(error);
          console.log("JSON output success");
          process.exit(0);
        } catch (e) {
          console.error("JSON.stringify failed:", e);
          process.exit(1);
        }
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: tempDir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("instanceof Error: true");
  expect(stdout).toContain("JSON output success");
  expect(stderr).not.toContain("AddressSanitizer");
  expect(stderr).not.toContain("heap-use-after-free");
});