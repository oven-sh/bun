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
