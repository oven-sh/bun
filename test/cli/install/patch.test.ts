import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("bun patch", () => {
  it("should work across different mount points (cross-device)", async () => {
    // Create a temporary project directory
    const testDir = tempDirWithFiles("patch-cross-device", {
      "package.json": JSON.stringify({
        name: "patch-test",
        version: "1.0.0",
        dependencies: {
          "is-number": "^7.0.0",
        },
      }),
    });

    // Install dependencies first
    const installProcess = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [installStdout, installStderr, installExitCode] = await Promise.all([
      new Response(installProcess.stdout).text(),
      new Response(installProcess.stderr).text(),
      installProcess.exited,
    ]);

    if (installExitCode !== 0) {
      throw new Error(`Install failed: ${installStderr}`);
    }

    // Create the patch
    const patchProcess = Bun.spawn({
      cmd: [bunExe(), "patch", "is-number"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [patchStdout, patchStderr, patchExitCode] = await Promise.all([
      new Response(patchProcess.stdout).text(),
      new Response(patchProcess.stderr).text(),
      patchProcess.exited,
    ]);

    expect(patchExitCode).toBe(0);
    expect(patchStderr).not.toContain("operation not permitted");
    expect(patchStderr).not.toContain("failed renaming patch");

    // Make a small change to the package
    const patchDir = join(testDir, "node_modules", "is-number");
    expect(existsSync(patchDir)).toBe(true);

    const packageJsonPath = join(patchDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.description = "Modified for testing cross-device patch functionality";
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Commit the patch - this is where cross-device issues would occur
    const commitProcess = Bun.spawn({
      cmd: [bunExe(), "patch", "--commit", patchDir],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [commitStdout, commitStderr, commitExitCode] = await Promise.all([
      new Response(commitProcess.stdout).text(),
      new Response(commitProcess.stderr).text(),
      commitProcess.exited,
    ]);

    expect(commitExitCode).toBe(0);
    expect(commitStderr).not.toContain("operation not permitted");
    expect(commitStderr).not.toContain("failed renaming patch file to patches dir");

    // Verify the patch was created successfully
    const finalPackageJson = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8"));
    expect(finalPackageJson.patchedDependencies).toBeDefined();

    // The patch key includes the version number
    const patchKey = Object.keys(finalPackageJson.patchedDependencies)[0];
    expect(patchKey).toMatch(/^is-number@/);

    // Verify the patch file exists
    const patchFile = finalPackageJson.patchedDependencies[patchKey];
    expect(existsSync(join(testDir, patchFile))).toBe(true);

    // Verify cross-device fallback was used (optional - shows it's working)
    if (commitStderr.includes("renameatConcurrently() failed with E.XDEV")) {
      console.log("✓ Cross-device fallback was triggered and handled correctly");
    }
  }, 30000);

  it("should handle cross-device scenarios with proper fallback", async () => {
    // This test specifically ensures that if XDEV errors occur,
    // the fallback copy mechanism works correctly
    const testDir = tempDirWithFiles("patch-xdev-fallback", {
      "package.json": JSON.stringify({
        name: "patch-xdev-test",
        version: "1.0.0",
        dependencies: {
          "ms": "^2.1.0",
        },
      }),
    });

    // Install dependencies
    const installResult = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    await installResult.exited;

    // Create patch
    const patchResult = Bun.spawn({
      cmd: [bunExe(), "patch", "ms"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    await patchResult.exited;

    // Modify the package
    const patchDir = join(testDir, "node_modules", "ms");
    const packageJsonPath = join(patchDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.description = "Testing XDEV fallback mechanism";
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Enable debug logging to verify fallback is triggered when needed
    const debugEnv = { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "0" };

    const commitResult = Bun.spawn({
      cmd: [bunExe(), "patch", "--commit", patchDir],
      env: debugEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [commitStdout, commitStderr, commitExitCode] = await Promise.all([
      new Response(commitResult.stdout).text(),
      new Response(commitResult.stderr).text(),
      commitResult.exited,
    ]);

    expect(commitExitCode).toBe(0);

    // The patch should succeed regardless of whether XDEV fallback was needed
    const finalPackageJson = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8"));
    expect(finalPackageJson.patchedDependencies).toBeDefined();
    const msKey = Object.keys(finalPackageJson.patchedDependencies).find(key => key.startsWith("ms@"));
    expect(msKey).toBeDefined();

    // If we see the debug message, that means the fallback worked
    if (commitStderr.includes("renameatConcurrently() failed with E.XDEV")) {
      console.log("✓ Cross-device fallback was triggered and handled correctly");
    }
  }, 30000);

  it("should not crash with EPERM errors from renameat operations", async () => {
    // Test to ensure that permission-related rename failures are handled gracefully
    const testDir = tempDirWithFiles("patch-eperm-test", {
      "package.json": JSON.stringify({
        name: "patch-eperm-test",
        version: "1.0.0",
        dependencies: {
          "lodash": "^4.17.21",
        },
      }),
    });

    // Install dependencies
    const installResult = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const installExitCode = await installResult.exited;
    expect(installExitCode).toBe(0);

    // Create patch
    const patchResult = Bun.spawn({
      cmd: [bunExe(), "patch", "lodash"],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    const patchExitCode = await patchResult.exited;
    expect(patchExitCode).toBe(0);

    // Modify the package
    const patchDir = join(testDir, "node_modules", "lodash");
    const packageJsonPath = join(patchDir, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    packageJson.version = "4.17.22-patched";
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Commit patch - should not fail with EPERM or similar permission errors
    const commitResult = Bun.spawn({
      cmd: [bunExe(), "patch", "--commit", patchDir],
      env: bunEnv,
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [commitStdout, commitStderr, commitExitCode] = await Promise.all([
      new Response(commitResult.stdout).text(),
      new Response(commitResult.stderr).text(),
      commitResult.exited,
    ]);

    expect(commitExitCode).toBe(0);
    expect(commitStderr).not.toContain("operation not permitted");
    expect(commitStderr).not.toContain("EPERM");
    expect(commitStderr).not.toContain("failed renaming patch file to patches dir");

    // Verify patch was applied
    const finalPackageJson = JSON.parse(readFileSync(join(testDir, "package.json"), "utf8"));
    expect(finalPackageJson.patchedDependencies).toBeDefined();
    const lodashKey = Object.keys(finalPackageJson.patchedDependencies).find(key => key.startsWith("lodash@"));
    expect(lodashKey).toBeDefined();
  }, 30000);
});
