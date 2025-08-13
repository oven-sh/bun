import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for Windows bin linking assertion crash
// https://github.com/oven-sh/bun/issues/XXXX
test("bin linking should not crash on Windows with non-standard paths", async () => {
  const testDir = tempDirWithFiles("bin-link-crash", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      dependencies: {
        "dep-with-file-bin": "1.0.0",
      },
    }),
  });

  // Install the package - this should not crash with assertion failure
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should not crash with "Internal assertion failure at install/bin.zig:690:83"
  expect(stderr).not.toContain("Internal assertion failure");
  expect(stderr).not.toContain("assertWithLocation");
  expect(exitCode).toBe(0);

  // Verify the bin was created properly
  const binDir = join(testDir, "node_modules", ".bin");
  const binExists = await Bun.file(join(binDir, "dep-with-file-bin")).exists();
  const bunxExists = await Bun.file(join(binDir, "dep-with-file-bin.bunx")).exists();
  
  if (process.platform === "win32") {
    expect(bunxExists).toBe(true);
  } else {
    expect(binExists).toBe(true);
  }
});

// Test with custom global install directory to trigger edge case paths
test("global bin linking should not crash with custom BUN_INSTALL", async () => {
  const testDir = tempDirWithFiles("global-bin-crash", {});
  const globalInstallDir = join(testDir, "custom-global");

  // Try to install a package globally with custom BUN_INSTALL
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "-g", "dep-with-file-bin"],
    env: { 
      ...bunEnv, 
      BUN_INSTALL: globalInstallDir 
    },
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should not crash with assertion failure
  expect(stderr).not.toContain("Internal assertion failure");
  expect(stderr).not.toContain("assertWithLocation");
  
  // Note: exit code might be non-zero due to network/registry issues, 
  // but it should not be an assertion crash
  if (exitCode !== 0) {
    expect(stderr).not.toContain("panic:");
  }
});