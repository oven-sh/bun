import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The project has no lockfile, so `bun update --interactive` prints its header
// and exits before the prompt. It never reads stdin. The "n" keystroke is
// handed over as a Blob so the parent never writes to a pipe the child may
// already have closed.
async function runUpdateInteractive(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "update", "--interactive", "--dry-run"],
    cwd: dir,
    env: bunEnv,
    stdin: new Blob(["n\n"]),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout: normalizeOutput(stdout), stderr, exitCode };
}

describe("bun update --interactive snapshots", () => {
  it("should not crash with various package name lengths", async () => {
    await using dir = tempDir("update-interactive-snapshot-test", {
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

    const { stdout, stderr, exitCode } = await runUpdateInteractive(String(dir));

    // The output should show proper column spacing and formatting
    expect(stdout).toMatchSnapshot("update-interactive-no-crash");

    // Should not crash or have formatting errors
    expect(stderr).toContain("missing lockfile, nothing to update");
    expect(stderr).not.toContain("underflow");
    expect(stderr).not.toContain("overflow");
    expect(exitCode).toBe(1);
  });

  it("should handle extremely long package names without crashing", async () => {
    const veryLongName = "a".repeat(80);
    await using dir = tempDir("update-interactive-long-names", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          [veryLongName]: "1.0.0",
          "regular-package": "1.0.0",
        },
      }),
    });

    const { stdout, stderr, exitCode } = await runUpdateInteractive(String(dir));

    // Should not crash
    expect(stdout).toMatchSnapshot("update-interactive-long-names");
    expect(stderr).toContain("missing lockfile, nothing to update");
    expect(stderr).not.toContain("underflow");
    expect(exitCode).toBe(1);
  });

  it("should handle complex version strings without crashing", async () => {
    await using dir = tempDir("update-interactive-complex-versions", {
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

    const { stdout, stderr, exitCode } = await runUpdateInteractive(String(dir));

    // Should not crash
    expect(stdout).toMatchSnapshot("update-interactive-complex-versions");
    expect(stderr).toContain("missing lockfile, nothing to update");
    expect(stderr).not.toContain("underflow");
    expect(exitCode).toBe(1);
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
