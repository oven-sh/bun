import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun update --interactive snapshots", () => {
  it("should not crash with various package name lengths", async () => {
    const dir = tempDirWithFiles("update-interactive-snapshot-test", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "short": "1.0.0",
          "react": "17.0.2",
          "really-long-package-name-for-testing": "1.0.0",
          "@scoped/package": "1.0.0",
          "@organization/extremely-long-scoped-package-name": "1.0.0",
        },
        devDependencies: {
          "dev-pkg": "1.0.0",
          "super-long-dev-package-name-for-testing": "1.0.0",
          "typescript": "4.8.0",
        },
        peerDependencies: {
          "peer-pkg": "1.0.0",
          "very-long-peer-dependency-name": "1.0.0",
        },
        optionalDependencies: {
          "optional-pkg": "1.0.0",
          "long-optional-dependency-name": "1.0.0",
        },
      }),
    });

    // Test that the command doesn't crash with mixed package lengths
    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Send 'n' to exit without selecting anything
    result.stdin.write("n\n");
    result.stdin.end();

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    // Replace version numbers and paths to avoid flakiness
    const normalizedOutput = normalizeOutput(stdout);

    // The output should show proper column spacing and formatting
    expect(normalizedOutput).toMatchSnapshot("update-interactive-no-crash");

    // Should not crash or have formatting errors
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
  });

  it("should handle extremely long package names without crashing", async () => {
    const veryLongName = "a".repeat(80);
    const dir = tempDirWithFiles("update-interactive-long-names", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [veryLongName]: "1.0.0",
          "regular-package": "1.0.0",
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    result.stdin.write("n\n");
    result.stdin.end();

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    const normalizedOutput = normalizeOutput(stdout);

    // Should not crash
    expect(normalizedOutput).toMatchSnapshot("update-interactive-long-names");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("underflow");
  });

  it("should handle complex version strings without crashing", async () => {
    const dir = tempDirWithFiles("update-interactive-complex-versions", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "package-with-long-version": "1.0.0-alpha.1.2.3.4.5.6.7.8.9.10.11.12",
          "package-with-prerelease": "1.0.0-beta.1+build.12345",
          "package-with-short-version": "1.0.0",
        },
      }),
    });

    const result = await Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    result.stdin.write("n\n");
    result.stdin.end();

    const stdout = await new Response(result.stdout).text();
    const stderr = await new Response(result.stderr).text();

    const normalizedOutput = normalizeOutput(stdout);

    // Should not crash
    expect(normalizedOutput).toMatchSnapshot("update-interactive-complex-versions");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("underflow");
  });
});

describe("bun update --interactive messages", () => {
  it("should show appropriate message for select-all operation", async () => {
    // Test that the interactive update command shows helpful messages when
    // packages are selected via 'A' (select all by caret-compatibility).
    //
    // The fix ensures that when packages are already at their target version,
    // we show "X packages are already at target version (use 'l' to select latest)"
    // instead of the confusing "No packages selected for update".

    const dir = tempDirWithFiles("update-interactive-messages", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          // Use caret range to test caret-compatibility behavior
          "is-number": "^7.0.0",
        },
      }),
    });

    // Run bun install to create a lockfile
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installProc.exited;

    // Run update --interactive with select all
    await using proc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive", "--dry-run"],
      cwd: dir,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Press 'A' to select all packages by caret-compatibility, then 'y' to confirm
    proc.stdin.write("A");
    proc.stdin.write("y");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const combinedOutput = stdout + stderr;

    // The output should contain one of these valid responses:
    // 1. "All packages are up to date" - no updates available at all
    // 2. "already at target version" - packages selected but at target (new message from this PR)
    // 3. "Would update" - dry-run showing actual updates
    const hasValidResponse =
      combinedOutput.includes("All packages are up to date") ||
      combinedOutput.includes("already at target version") ||
      combinedOutput.includes("Would update");

    expect(hasValidResponse).toBe(true);

    // If the new message appears, verify it includes the hint about using 'l'
    if (combinedOutput.includes("already at target version")) {
      expect(combinedOutput).toContain("use 'l'");
    }

    // Verify successful execution
    expect(exitCode).toBe(0);
  });
});

function normalizeOutput(output: string): string {
  // Remove Bun version to avoid test flakiness
  let normalized = output.replace(/bun update --interactive v\d+\.\d+\.\d+[^\n]*/g, "bun update --interactive vX.X.X");

  // Normalize any absolute paths
  normalized = normalized.replace(/\/tmp\/[^\/\s]+/g, "/tmp/test-dir");

  // Remove ANSI color codes for cleaner snapshots
  normalized = normalized.replace(/\x1b\[[0-9;]*m/g, "");

  // Remove progress indicators and timing info
  normalized = normalized.replace(/[\r\n]*\s*\([0-9.]+ms\)/g, "");

  // Normalize whitespace
  normalized = normalized.replace(/\r\n/g, "\n");

  return normalized.trim();
}
