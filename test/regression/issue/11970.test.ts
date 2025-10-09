// Regression test for issue #11970
// bun remove -g should remove binaries on Windows
import { test, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { existsSync } from "fs";

test("bun remove -g should remove binaries", async () => {
  if (!isWindows) {
    // This test is specifically for Windows
    return;
  }

  using dir = tempDir("global-remove-test", {
    "package.json": JSON.stringify({
      name: "test-pkg",
      version: "1.0.0",
      bin: {
        testbin: "./testbin.js",
      },
    }),
    "testbin.js": `#!/usr/bin/env node
console.log("test");
`,
  });

  // Set up a custom global bin directory
  using globalDir = tempDir("global-bin-dir", {});
  const globalBinPath = String(globalDir);
  const env = {
    ...bunEnv,
    BUN_INSTALL_BIN: globalBinPath,
  };

  // Install the package globally
  const installProc = Bun.spawn({
    cmd: [bunExe(), "add", "-g", `file:${String(dir)}`],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const installExitCode = await installProc.exited;
  expect(installExitCode).toBe(0);

  // Verify the binaries were created
  const exePath = join(globalBinPath, "testbin.exe");
  const bunxPath = join(globalBinPath, "testbin.bunx");

  expect(existsSync(exePath)).toBe(true);
  expect(existsSync(bunxPath)).toBe(true);

  // Remove the package globally
  const removeProc = Bun.spawn({
    cmd: [bunExe(), "remove", "-g", "test-pkg"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const removeExitCode = await removeProc.exited;
  expect(removeExitCode).toBe(0);

  // Verify the binaries were removed
  expect(existsSync(exePath)).toBe(false);
  expect(existsSync(bunxPath)).toBe(false);
});
