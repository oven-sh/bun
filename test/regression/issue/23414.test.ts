// https://github.com/oven-sh/bun/issues/23414
// Bun crashes when trying to install packages with bin links on Windows
// This was caused by an overly strict assertion that expected all relative paths
// to start with "..\\" when linking bins, but edge cases exist where this isn't true.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test("bin linking should not crash with assertion failure on Windows", async () => {
  if (!isWindows) {
    // This test is Windows-specific, skip on other platforms
    return;
  }

  using dir = tempDir("bin-linking-test", {
    "package.json": JSON.stringify({
      name: "test-package",
      version: "1.0.0",
      dependencies: {
        "cowsay": "1.6.0",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The main fix is that this should not panic with:
  // "panic: Internal assertion failure at install/bin.zig:723:83"
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("assertion failure");
  expect(stderr).not.toContain("bin.zig:723");

  // Verify the install completed successfully
  expect(exitCode).toBe(0);
  expect(stderr).toContain("package installed");
});
